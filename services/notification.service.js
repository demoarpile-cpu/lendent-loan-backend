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

    if (phone && smsBody) {
        result.sms = await twilioService.sendSms({ to: phone, body: smsBody });
    }

    if (email && emailSubject && (emailHtml || emailText)) {
        result.email = await twilioService.sendEmail({
            to: email,
            subject: emailSubject,
            html: emailHtml,
            text: emailText
        });
    }

    if (oneSignalPlayerId && pushBody) {
        result.push = await oneSignalService.sendPush({
            playerIds: [oneSignalPlayerId],
            headings: pushTitle || 'LendaNet',
            contents: pushBody
        });
    }

    return result;
}

module.exports = {
    sendMultiChannel
};
