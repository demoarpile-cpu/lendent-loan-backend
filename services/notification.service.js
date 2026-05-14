const twilioService = require('./twilio.service');
const oneSignalService = require('./onesignal.service');

async function sendMultiChannel({
    phone,
    email,
    oneSignalPlayerId,
    smsBody,
    emailSubject,
    emailHtml,
    emailText,
    pushTitle,
    pushBody
}) {
    const result = {
        sms: null,
        email: null,
        push: null
    };

    const results = await Promise.allSettled([
        phone && smsBody ? twilioService.sendSms({ to: phone, body: smsBody }) : Promise.resolve(null),
        // OneSignal can handle both Push and Email if configured
        (oneSignalPlayerId || email) ? oneSignalService.sendPush({
            playerIds: oneSignalPlayerId ? [oneSignalPlayerId] : [],
            email: email || null,
            headings: pushTitle || emailSubject || 'LendaNet',
            contents: pushBody || emailText || smsBody
        }) : Promise.resolve(null),
        // Keep Twilio Email as a secondary option or for direct transactional emails
        email && emailSubject && !oneSignalPlayerId ? twilioService.sendEmail({
            to: email,
            subject: emailSubject,
            html: emailHtml,
            text: emailText
        }) : Promise.resolve(null)
    ]);

    result.sms = results[0].status === 'fulfilled' ? results[0].value : { ok: false, reason: results[0].reason };
    result.push = results[1].status === 'fulfilled' ? results[1].value : { ok: false, reason: results[1].reason };
    result.email = results[2].status === 'fulfilled' ? results[2].value : { ok: false, reason: results[2].reason };

    console.log('[NotificationService] Dispatch Results:', {
        sms: result.sms,
        push_and_email: result.push,
        direct_email: result.email
    });
    return result;
}

module.exports = {
    sendMultiChannel
};
