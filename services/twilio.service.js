const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const smsFrom = process.env.TWILIO_SMS_FROM || null;
const smsAlphaSender = process.env.TWILIO_SMS_ALPHA_SENDER || null;
const emailFrom = process.env.TWILIO_EMAIL_FROM || null;

let client = null;
if (accountSid && authToken) {
    client = twilio(accountSid, authToken);
}

function isConfigured() {
    return Boolean(client);
}

async function sendSms({ to, body }) {
    if (!to || !body) return { ok: false, reason: 'Missing phone/body' };
    if (!client) return { ok: false, reason: 'Twilio is not configured' };

    const payload = { to, body };
    if (smsAlphaSender) payload.from = smsAlphaSender;
    else if (smsFrom) payload.from = smsFrom;
    else return { ok: false, reason: 'Missing TWILIO_SMS_FROM or TWILIO_SMS_ALPHA_SENDER' };

    try {
        const result = await client.messages.create(payload);
        return { ok: true, sid: result.sid };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

async function sendEmail({ to, subject, html, text }) {
    if (!to || !subject || (!html && !text)) {
        return { ok: false, reason: 'Missing to/subject/body' };
    }
    if (!client) return { ok: false, reason: 'Twilio is not configured' };
    if (!emailFrom) return { ok: false, reason: 'Missing TWILIO_EMAIL_FROM' };

    try {
        // Twilio SendGrid API v3 over Twilio client request wrapper.
        await client.request({
            method: 'POST',
            uri: '/v3/mail/send',
            headers: { 'Content-Type': 'application/json' },
            body: {
                personalizations: [{ to: [{ email: to }], subject }],
                from: { email: emailFrom },
                content: [
                    html ? { type: 'text/html', value: html } : null,
                    text ? { type: 'text/plain', value: text } : null
                ].filter(Boolean)
            }
        });

        return { ok: true };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

module.exports = {
    isConfigured,
    sendSms,
    sendEmail
};
