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

    console.log(`[NotificationService] Dispatching multi-channel notification...`);
    console.log(`- SMS Target: ${phone ? phone : 'None'}`);
    console.log(`- Email Target: ${email ? email : 'None'}`);
    console.log(`- Push Target Player ID: ${oneSignalPlayerId ? oneSignalPlayerId : 'None'}`);

    const results = await Promise.allSettled([
        // 1. Deliver SMS via Twilio
        phone && smsBody 
            ? twilioService.sendSms({ to: phone, body: smsBody }) 
            : Promise.resolve(null),
        
        // 2. Deliver Push Notification via OneSignal
        oneSignalPlayerId && (pushBody || smsBody)
            ? oneSignalService.sendPush({
                playerIds: [oneSignalPlayerId],
                headings: pushTitle || 'LendaNet',
                contents: pushBody || smsBody
            }) 
            : Promise.resolve(null),
        
        // 3. Deliver Transactional Email
        email && emailSubject && (emailHtml || emailText)
            ? twilioService.sendEmail({
                to: email,
                subject: emailSubject,
                html: emailHtml,
                text: emailText || emailHtml.replace(/<[^>]*>/g, '')
            }) 
            : Promise.resolve(null)
    ]);

    result.sms = results[0].status === 'fulfilled' ? results[0].value : { ok: false, reason: results[0].reason };
    result.push = results[1].status === 'fulfilled' ? results[1].value : { ok: false, reason: results[1].reason };
    result.email = results[2].status === 'fulfilled' ? results[2].value : { ok: false, reason: results[2].reason };

    console.log('[NotificationService] Final Dispatch Results:', {
        sms: result.sms,
        push: result.push,
        email: result.email
    });
    
    return result;
}

module.exports = {
    sendMultiChannel
};
