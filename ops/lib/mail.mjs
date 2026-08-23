// Email via Resend. Free tier covers 3,000 a month, which is far more than a
// team of eleven will ever send.
//
// A send that fails is logged and swallowed on purpose: a broken mail provider
// must not stop the digest job from finishing and recording what it found.

const KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM || "iHelp Ops <ops@ihelprobotics.com>";

export async function sendMail({ to, subject, body }) {
  if (!KEY) {
    console.warn(`[mail] RESEND_API_KEY not set — would have sent "${subject}" to ${to}`);
    return { skipped: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text: body }),
  });

  if (!res.ok) {
    console.error(`[mail] failed for ${to}: ${res.status} ${await res.text()}`);
    return { ok: false };
  }
  return { ok: true };
}
