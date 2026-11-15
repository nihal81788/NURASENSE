"""
NuraSense TPP — Emergency Clinical Alert System
Handles automated multi-channel emergency alert delivery when critical hypokalemia
is detected by the Kardio-Net ML / T-Wave estimation pipeline.

Channels:
1. Fast2SMS HTTP API — Immediate SMS dispatch to family & care circle numbers
2. Twilio Programmable Voice — Automated synthesized voice phone call to patient
3. EmailJS HTTP API — Clinical emergency dispatch email with Google Maps location
4. Supabase DB — Audit logging into `alert_logs` table & in-memory cache fallback

Cooldown:
Strict 30-minute cooldown per patient (user_id) to prevent alert flooding/spam.
"""

import os
import time
import asyncio
from typing import Optional, Dict, Any, List
import httpx


class AlertSystem:
    def __init__(self):
        # API Keys & Credentials
        self.fast2sms_api_key = os.getenv("FAST2SMS_API_KEY", "").strip().strip('"').strip("'")
        self.twilio_account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip().strip('"').strip("'")
        self.twilio_auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip().strip('"').strip("'")
        self.twilio_phone_number = os.getenv("TWILIO_PHONE_NUMBER", "").strip().strip('"').strip("'")

        # EmailJS configuration (with standard fallback identifiers)
        self.emailjs_service_id = os.getenv("EMAILJS_SERVICE_ID", "service_nurasense").strip().strip('"').strip("'")
        self.emailjs_template_id = os.getenv("EMAILJS_TEMPLATE_ID", "template_tpp_alert").strip().strip('"').strip("'")
        self.emailjs_public_key = os.getenv("EMAILJS_PUBLIC_KEY", "").strip().strip('"').strip("'")
        self.emailjs_private_key = os.getenv("EMAILJS_PRIVATE_KEY", "").strip().strip('"').strip("'")

        # 30-minute cooldown tracker: user_id -> last_alert_timestamp
        self.cooldown_tracker: Dict[str, float] = {}
        self.cooldown_seconds: float = 1800.0  # 30 minutes

        # In-memory alert log cache (for fallback if Supabase table is not yet created or offline)
        self.in_memory_logs: Dict[str, List[Dict[str, Any]]] = {}

        # Last debug status messages
        self.last_sms_debug: str = ""
        self.last_call_debug: str = ""
        self.last_email_debug: str = ""

        # Initialize Twilio REST client if credentials provided
        self.twilio_client = None
        if self.twilio_account_sid and self.twilio_auth_token:
            try:
                from twilio.rest import Client
                self.twilio_client = Client(self.twilio_account_sid, self.twilio_auth_token)
                print("[AlertSystem] Twilio voice client initialized successfully.")
            except Exception as e:
                print(f"[AlertSystem] Twilio client initialization note: {e}")

    def is_cooldown_active(self, user_id: str) -> bool:
        """Check if 30 min cooldown is active for this user."""
        last_time = self.cooldown_tracker.get(user_id, 0.0)
        return (time.time() - last_time) < self.cooldown_seconds

    def generate_location_link(self, location: Optional[dict]) -> str:
        """
        Generates Google Maps pin link from coordinates:
        location = {"lat": float, "lng": float}
        Return: https://maps.google.com/?q={lat},{lng}
        """
        if not location or not isinstance(location, dict):
            return ""
        lat = location.get("lat")
        lng = location.get("lng")
        if lat is not None and lng is not None:
            try:
                return f"https://maps.google.com/?q={float(lat):.6f},{float(lng):.6f}"
            except (ValueError, TypeError):
                return ""
        return ""

    async def send_sms_fast2sms(self, phones: List[str], message: str) -> tuple[bool, str]:
        """
        Fast2SMS Quick Transactional SMS API call:
        POST https://www.fast2sms.com/dev/bulkV2
        headers: authorization: FAST2SMS_API_KEY
        body: {
          "route": "q",
          "message": message,
          "language": "english",
          "flash": 0,
          "numbers": "91XXXXXXXXXX,91XXXXXXXXXX"
        }
        """
        if not self.fast2sms_api_key:
            msg = "FAST2SMS_API_KEY is not set in Railway environment variables."
            print(f"[AlertSystem] Fast2SMS skipped: {msg}")
            self.last_sms_debug = msg
            return False, msg

        if not phones:
            msg = "No contact phone numbers found in emergency contacts."
            print(f"[AlertSystem] Fast2SMS skipped: {msg}")
            self.last_sms_debug = msg
            return False, msg

        # Clean numbers: strip non-digits, extract 10-digit Indian mobile format
        cleaned_phones = []
        for p in phones:
            digits = "".join(c for c in str(p) if c.isdigit())
            if len(digits) == 10:
                cleaned_phones.append(digits)
            elif len(digits) == 12 and digits.startswith("91"):
                cleaned_phones.append(digits[2:])
            elif len(digits) > 10:
                cleaned_phones.append(digits[-10:])

        if not cleaned_phones:
            msg = f"Could not extract valid 10-digit Indian numbers from {phones}"
            print(f"[AlertSystem] {msg}")
            self.last_sms_debug = msg
            return False, msg

        numbers_str = ",".join(cleaned_phones)

        # Fast2SMS requires short messages for single-credit dispatch. Truncate if too long.
        safe_message = message[:159] if len(message) > 160 else message

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {
                    "authorization": self.fast2sms_api_key,
                    "Authorization": self.fast2sms_api_key,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
                body = {
                    "route": "q",
                    "message": safe_message,
                    "language": "english",
                    "flash": 0,
                    "numbers": numbers_str
                }
                resp = await client.post("https://www.fast2sms.com/dev/bulkV2", json=body, headers=headers)
                
                try:
                    data = resp.json()
                except Exception:
                    data = {}

                # Fast2SMS returns: {"return": true, "request_id": "...", "message": ["SMS sent successfully."]}
                if resp.status_code == 200 and data.get("return") is True:
                    success_msg = f"Dispatched to {numbers_str} (Request ID: {data.get('request_id', 'ok')})"
                    print(f"[AlertSystem] Fast2SMS alert successfully sent: {success_msg}")
                    self.last_sms_debug = success_msg
                    return True, success_msg
                else:
                    err_detail = data.get("message") or resp.text or f"HTTP {resp.status_code}"
                    if isinstance(err_detail, list):
                        err_detail = ", ".join(str(x) for x in err_detail)
                    err_msg = f"Fast2SMS API rejected (HTTP {resp.status_code}): {err_detail}"
                    print(f"[AlertSystem] {err_msg}")
                    self.last_sms_debug = err_msg
                    return False, err_msg
        except Exception as e:
            err_msg = f"Fast2SMS network error: {str(e)}"
            print(f"[AlertSystem] {err_msg}")
            self.last_sms_debug = err_msg
            return False, err_msg

    async def send_voice_call_twilio(self, patient_phone: str, potassium_mmol: float) -> tuple[bool, str]:
        """
        Twilio Programmable Voice call:
        - Calls patient's phone number
        - Speaks TwiML message via natural Indian English TTS
        - Reminds patient to take immediate oral potassium chloride supplement
        """
        if not self.twilio_account_sid or not self.twilio_auth_token or not self.twilio_phone_number:
            msg = "Twilio credentials (SID/TOKEN/PHONE) not configured."
            print(f"[AlertSystem] Twilio voice call skipped: {msg}")
            self.last_call_debug = msg
            return False, msg

        if not patient_phone:
            msg = "Patient phone number not provided."
            print(f"[AlertSystem] Twilio voice call skipped: {msg}")
            self.last_call_debug = msg
            return False, msg

        to_phone = str(patient_phone).strip()
        if not to_phone.startswith("+"):
            to_phone = f"+91{to_phone}" if len(to_phone) == 10 else f"+{to_phone}"

        twiml_msg = (
            f"<Response><Say voice='Polly.Aditi' language='en-IN'>"
            f"NuraSense Alert. Your potassium level is critically low at {potassium_mmol:.1f} millimoles per litre. "
            f"Please take your prescribed potassium supplement immediately. "
            f"This is an automated reminder from your NuraSense TPP monitoring system."
            f"</Say></Response>"
        )

        try:
            from twilio.rest import Client
            client = self.twilio_client or Client(self.twilio_account_sid, self.twilio_auth_token)
            loop = asyncio.get_running_loop()
            call = await loop.run_in_executor(
                None,
                lambda: client.calls.create(
                    twiml=twiml_msg,
                    to=to_phone,
                    from_=self.twilio_phone_number
                )
            )
            msg = f"Twilio voice call placed to {to_phone} (Call SID: {call.sid})"
            print(f"[AlertSystem] {msg}")
            self.last_call_debug = msg
            return True, msg
        except Exception as e:
            msg = f"Twilio voice call error: {str(e)}"
            print(f"[AlertSystem] {msg}")
            self.last_call_debug = msg
            return False, msg

    async def send_email_emailjs(
        self,
        contacts: List[Dict[str, Any]],
        potassium_mmol: float,
        location_link: str
    ) -> tuple[bool, str]:
        """
        EmailJS HTTP API:
        POST https://api.emailjs.com/api/v1.0/email/send
        Dispatches clinical emergency notice with live location link to all contact emails.
        """
        if not self.emailjs_public_key:
            msg = "EMAILJS_PUBLIC_KEY not set in environment."
            print(f"[AlertSystem] EmailJS skipped: {msg}")
            self.last_email_debug = msg
            return False, msg

        dispatched_count = 0
        last_error = ""
        async with httpx.AsyncClient(timeout=10.0) as client:
            for c in contacts:
                email = c.get("email")
                if not email:
                    continue

                template_params = {
                    "to_email": email,
                    "contact_name": c.get("name", "Emergency Contact"),
                    "patient_name": c.get("patient_name", "NuraSense Patient"),
                    "potassium_level": f"{potassium_mmol:.1f} mmol/L",
                    "risk_level": "CRITICAL HYPOKALEMIA (TPP EARLY WARNING)",
                    "location_link": location_link or "Not shared",
                    "timestamp": time.strftime("%d %b %Y · %H:%M UTC", time.gmtime())
                }

                body: Dict[str, Any] = {
                    "service_id": self.emailjs_service_id,
                    "template_id": self.emailjs_template_id,
                    "user_id": self.emailjs_public_key,
                    "template_params": template_params
                }
                if self.emailjs_private_key:
                    body["accessToken"] = self.emailjs_private_key

                try:
                    resp = await client.post("https://api.emailjs.com/api/v1.0/email/send", json=body)
                    if resp.status_code in (200, 201):
                        print(f"[AlertSystem] EmailJS alert email dispatched to {email}")
                        dispatched_count += 1
                    else:
                        last_error = f"HTTP {resp.status_code} - {resp.text}"
                        print(f"[AlertSystem] EmailJS response for {email}: {last_error}")
                except Exception as ex:
                    last_error = str(ex)
                    print(f"[AlertSystem] EmailJS send error for {email}: {ex}")

        if dispatched_count > 0:
            msg = f"Dispatched to {dispatched_count} contact(s)."
            self.last_email_debug = msg
            return True, msg
        else:
            msg = f"No emails sent ({last_error or 'no valid emails'})"
            self.last_email_debug = msg
            return False, msg

    def reset_cooldown(self, user_id: str):
        """Resets the cooldown for this user so alerts can fire immediately."""
        self.cooldown_tracker.pop(user_id, None)
        print(f"[AlertSystem] Cooldown reset for user {user_id}")

    async def send_all_alerts(
        self,
        user_id: str,
        potassium_mmol: float,
        location: dict,
        supabase_client,
        bypass_cooldown: bool = False
    ) -> Dict[str, Any]:
        """
        Main alert orchestrator:
        1. Enforces 30-minute cooldown per user to prevent notification spam (unless bypass_cooldown=True)
        2. Queries emergency_contacts from Supabase
        3. Sends SMS to family members via Fast2SMS
        4. Initiates Twilio synthesized voice call to patient
        5. Sends clinical alert email via EmailJS
        6. Persists audit record in Supabase alert_logs & in-memory cache
        """
        # Check cooldown (bypassed for manual testing)
        if not bypass_cooldown and self.is_cooldown_active(user_id):
            remaining = int(self.cooldown_seconds - (time.time() - self.cooldown_tracker.get(user_id, 0.0)))
            print(f"[AlertSystem] Cooldown active for user {user_id}. Next alert allowed in {remaining}s.")
            return {
                "status": "cooldown_active",
                "remaining_seconds": remaining,
                "sms_sent": False,
                "call_sent": False,
                "email_sent": False,
                "message": f"Cooldown active: {remaining}s remaining before next automated alert."
            }

        # Mark cooldown timestamp unless testing
        if not bypass_cooldown:
            self.cooldown_tracker[user_id] = time.time()
        print(f"[AlertSystem] 🚨 TRIGGERING EMERGENCY TPP ALERTS for user {user_id}: K+ = {potassium_mmol:.2f} mmol/L (bypass_cooldown={bypass_cooldown})")

        location_link = self.generate_location_link(location)
        contacts: List[Dict[str, Any]] = []

        # 1. Fetch emergency contacts from Supabase
        if supabase_client:
            try:
                loop = asyncio.get_running_loop()
                res = await loop.run_in_executor(
                    None,
                    lambda: supabase_client.table("emergency_contacts").select("*").eq("user_id", user_id).execute()
                )
                if res.data:
                    contacts = res.data
            except Exception as e:
                print(f"[AlertSystem] Notice fetching emergency_contacts from Supabase: {e}")

        # Extract contact numbers and patient phone
        sms_phones = [c["phone"] for c in contacts if c.get("phone")]
        patient_contacts = [
            c for c in contacts
            if c.get("is_patient") or str(c.get("relationship", "")).lower() in ("self", "patient", "me")
        ]
        patient_phone = patient_contacts[0]["phone"] if patient_contacts else (sms_phones[0] if sms_phones else "")

        # 2. Fast2SMS dispatch
        sms_sent = False
        sms_debug = "No phone numbers registered"
        if sms_phones:
            loc_str = f" Location: {location_link}" if location_link else ""
            sms_text = (
                f"NURASENSE EMERGENCY: Patient potassium critically low at {potassium_mmol:.1f} mmol/L. "
                f"High risk of Thyrotoxic Periodic Paralysis (TPP) attack.{loc_str} Please assist immediately."
            )
            sms_sent, sms_debug = await self.send_sms_fast2sms(sms_phones, sms_text)

        # 3. Twilio Voice Call dispatch
        call_sent = False
        call_debug = "No patient phone found"
        if patient_phone:
            call_sent, call_debug = await self.send_voice_call_twilio(patient_phone, potassium_mmol)

        # 4. EmailJS dispatch
        email_sent = False
        email_debug = "No email addresses registered"
        email_contacts = [c for c in contacts if c.get("email")]
        if email_contacts:
            email_sent, email_debug = await self.send_email_emailjs(email_contacts, potassium_mmol, location_link)

        # 5. Persist log entry to Supabase alert_logs table & in-memory cache
        lat = location.get("lat") if location else None
        lng = location.get("lng") if location else None
        now_iso = time.strftime("%Y-%m-%d %H:%M:%S+00", time.gmtime())

        log_entry = {
            "user_id": user_id,
            "potassium_level": round(float(potassium_mmol), 2),
            "risk_class": "hypokalemia",
            "location_lat": float(lat) if lat is not None else None,
            "location_lng": float(lng) if lng is not None else None,
            "sms_sent": bool(sms_sent),
            "call_sent": bool(call_sent),
            "email_sent": bool(email_sent),
            "contacts_notified": len(contacts),
            "created_at": now_iso
        }

        # Cache in memory
        if user_id not in self.in_memory_logs:
            self.in_memory_logs[user_id] = []
        self.in_memory_logs[user_id].insert(0, log_entry)
        if len(self.in_memory_logs[user_id]) > 50:
            self.in_memory_logs[user_id].pop()

        if supabase_client:
            try:
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: supabase_client.table("alert_logs").insert(log_entry).execute()
                )
                print(f"[AlertSystem] Alert log successfully saved to Supabase alert_logs for user {user_id}")
            except Exception as e:
                print(f"[AlertSystem] Note: Could not insert into Supabase alert_logs table: {e}")

        return {
            "status": "alert_dispatched",
            "potassium_mmol": potassium_mmol,
            "sms_sent": sms_sent,
            "sms_debug": sms_debug,
            "call_sent": call_sent,
            "call_debug": call_debug,
            "email_sent": email_sent,
            "email_debug": email_debug,
            "contacts_notified": len(contacts),
            "timestamp": now_iso
        }

    async def get_history(self, user_id: str, supabase_client) -> List[Dict[str, Any]]:
        """
        Retrieves the last 10 alert records for the given user from Supabase,
        falling back to in-memory history if Supabase is unavailable.
        """
        if supabase_client:
            try:
                loop = asyncio.get_running_loop()
                res = await loop.run_in_executor(
                    None,
                    lambda: supabase_client.table("alert_logs")
                    .select("*")
                    .eq("user_id", user_id)
                    .order("created_at", desc=True)
                    .limit(10)
                    .execute()
                )
                if res.data and len(res.data) > 0:
                    return res.data
            except Exception as e:
                print(f"[AlertSystem] get_history Supabase query note: {e}")

        # Return in-memory fallback
        return self.in_memory_logs.get(user_id, [])[:10]


# Global singleton instance
alert_system = AlertSystem()
