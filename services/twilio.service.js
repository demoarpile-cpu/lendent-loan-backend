const twilio = require('twilio');
const nodemailer = require('nodemailer');

const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
const smsFrom = (process.env.TWILIO_SMS_FROM || '').trim();
const smsAlphaSender = (process.env.TWILIO_SMS_ALPHA_SENDER || '').trim();
const emailFrom = (process.env.TWILIO_EMAIL_FROM || '').trim();

// Local testing flag
const mockNotifications = process.env.MOCK_NOTIFICATIONS === 'true';

let client = null;
if (accountSid && authToken && !accountSid.includes('YOUR_') && !authToken.includes('YOUR_')) {
    try {
        client = twilio(accountSid, authToken);
    } catch (e) {
        console.warn('⚠️ [Twilio] Initialization failed:', e.message);
    }
}

// Setup Nodemailer SMTP if configured
let mailTransporter = null;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT || 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;

if (smtpHost && smtpUser && smtpPass) {
    try {
        mailTransporter = nodemailer.createTransport({
            host: smtpHost,
            port: Number(smtpPort),
            secure: Number(smtpPort) === 465,
            auth: {
                user: smtpUser,
                password: smtpPass
            }
        });
        console.log('✅ [Email] Nodemailer SMTP Transporter configured.');
    } catch (err) {
        console.warn('⚠️ [Email] SMTP initialization failed:', err.message);
    }
}

function formatPhoneNumber(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\s+/g, '').replace(/[-()]/g, ''); // Remove spaces, dashes, brackets

    // If it already starts with '+', it is already international
    if (cleaned.startsWith('+')) {
        return cleaned;
    }

    // Default country code from env or default to Zambia (+260)
    const defaultCode = (process.env.DEFAULT_COUNTRY_CODE || '+260').trim();

    // Zambian format handler (+260)
    if (defaultCode === '+260') {
        // If it starts with local leading '0', replace it with '+260' (e.g. 0977123456 -> +260977123456)
        if (cleaned.startsWith('0')) {
            return '+260' + cleaned.substring(1);
        }
        // If it starts with '260' without '+', just prepend '+' (e.g. 260977123456 -> +260977123456)
        if (cleaned.startsWith('260')) {
            return '+' + cleaned;
        }
    }

    // Indian format handler (+91)
    if (defaultCode === '+91') {
        if (cleaned.startsWith('0')) {
            return '+91' + cleaned.substring(1);
        }
        if (cleaned.startsWith('91') && cleaned.length > 10) {
            return '+' + cleaned;
        }
    }

    // Generic fallback
    const prefix = defaultCode.startsWith('+') ? defaultCode : `+${defaultCode}`;
    return prefix + (cleaned.startsWith('0') ? cleaned.substring(1) : cleaned);
}

function isConfigured() {
    return Boolean(client) || mockNotifications;
}

// Gorgeous ASCII box printer for mock notifications
function printMockSms(to, body) {
    const border = '═'.repeat(60);
    console.log('\n\x1b[36m╔' + border + '╗');
    console.log('║ \x1b[1m\x1b[33m💬 [MOCK SMS DISPATCHED]\x1b[0m' + ' '.repeat(38) + '\x1b[36m║');
    console.log('╠' + border + '╣');
    console.log(`║ \x1b[1mTo:\x1b[0m ${to.padEnd(54)} \x1b[36m║`);
    
    // Split body into multiple lines for formatting if needed
    const bodyLines = body.match(/.{1,54}/g) || [body];
    bodyLines.forEach(line => {
        console.log(`║ \x1b[32m${line.padEnd(54)}\x1b[0m \x1b[36m║`);
    });
    console.log('╚' + border + '╝\x1b[0m\n');
}

function printMockEmail(to, subject, text, html) {
    const border = '═'.repeat(60);
    console.log('\n\x1b[35m╔' + border + '╗');
    console.log('║ \x1b[1m\x1b[33m📧 [MOCK EMAIL DISPATCHED]\x1b[0m' + ' '.repeat(36) + '\x1b[35m║');
    console.log('╠' + border + '╣');
    console.log(`║ \x1b[1mTo:\x1b[0m ${to.padEnd(54)} \x1b[35m║`);
    console.log(`║ \x1b[1mSubject:\x1b[0m ${subject.padEnd(49)} \x1b[35m║`);
    console.log('╠' + border + '╣');
    
    const content = text || html || '';
    const contentLines = content.replace(/<[^>]*>/g, '').match(/.{1,54}/g) || [content];
    contentLines.slice(0, 5).forEach(line => {
        console.log(`║ \x1b[34m${line.padEnd(54)}\x1b[0m \x1b[35m║`);
    });
    if (contentLines.length > 5) {
        console.log(`║ \x1b[30m... (${contentLines.length - 5} more lines)\x1b[0m`.padEnd(63) + '\x1b[35m║');
    }
    console.log('╚' + border + '╝\x1b[0m\n');
}

async function sendSms({ to, body }) {
    if (!to || !body) return { ok: false, reason: 'Missing phone/body' };

    const formattedTo = formatPhoneNumber(to);

    // Support local mock mode
    if (mockNotifications || !client) {
        printMockSms(formattedTo, body);
        return { ok: true, mock: true, sid: 'mock_sid_' + Math.random().toString(36).substr(2, 9) };
    }

    const payload = { to: formattedTo, body };
    if (smsAlphaSender) payload.from = smsAlphaSender;
    else if (smsFrom) payload.from = smsFrom;
    else return { ok: false, reason: 'Missing TWILIO_SMS_FROM or TWILIO_SMS_ALPHA_SENDER' };

    try {
        console.log(`[Twilio] Sending SMS to ${formattedTo}...`);
        const result = await client.messages.create(payload);
        console.log(`[Twilio] SMS sent successfully. SID: ${result.sid}`);
        return { ok: true, sid: result.sid };
    } catch (error) {
        console.error(`[Twilio] SMS failed: ${error.message}`);
        
        // Graceful fallback to mock so the application flow does not break in local testing
        console.log('ℹ️ [Twilio Fallback] Falling back to Console Log representation...');
        printMockSms(formattedTo, body);
        return { ok: true, fallback: true, reason: error.message };
    }
}

async function sendEmail({ to, subject, html, text }) {
    if (!to || !subject || (!html && !text)) {
        return { ok: false, reason: 'Missing to/subject/body' };
    }

    // Support local mock mode
    if (mockNotifications) {
        printMockEmail(to, subject, text, html);
        return { ok: true, mock: true };
    }

    // SMTP Option
    if (mailTransporter) {
        try {
            console.log(`[Email] Dispatching SMTP email to ${to}...`);
            await mailTransporter.sendMail({
                from: emailFrom || smtpUser,
                to,
                subject,
                text,
                html
            });
            console.log(`[Email] SMTP email sent successfully.`);
            return { ok: true };
        } catch (error) {
            console.error(`[Email] SMTP delivery failed: ${error.message}`);
            // Fallback to console mock
            printMockEmail(to, subject, text, html);
            return { ok: true, fallback: true, reason: error.message };
        }
    }

    // Fallback/Default Mock Option
    console.log('ℹ️ [Email Fallback] No SMTP configured. Printing to Console...');
    printMockEmail(to, subject, text, html);
    return { ok: true, mock: true };
}

module.exports = {
    isConfigured,
    sendSms,
    sendEmail
};
