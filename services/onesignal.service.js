const OneSignal = require('onesignal-node');

const appId = process.env.ONESIGNAL_APP_ID;
const apiKey = process.env.ONESIGNAL_REST_API_KEY;

let client = null;
if (appId && apiKey) {
    client = new OneSignal.Client(appId, apiKey);
}

function isConfigured() {
    return Boolean(client);
}

async function sendPush({ playerIds = [], headings = 'LendaNet', contents, email = null }) {
    if (!client) return { ok: false, reason: 'OneSignal is not configured' };
    if (!playerIds.length && !email) return { ok: false, reason: 'No player ids or email provided' };
    if (!contents) return { ok: false, reason: 'Missing push content' };

    try {
        const payload = {
            headings: { en: headings },
            contents: { en: contents }
        };

        if (playerIds.length > 0) {
            payload.include_player_ids = playerIds;
        }

        // If email is provided, OneSignal can attempt to send an email if configured in dashboard
        if (email) {
            payload.filters = [{ field: 'email', value: email }];
        }

        console.log(`[OneSignal] Dispatching notification to ${playerIds.length} devices and email: ${email || 'None'}`);
        const response = await client.createNotification(payload);
        return { ok: true, response };
    } catch (error) {
        console.error(`[OneSignal] Notification failed: ${error.message}`);
        return { ok: false, reason: error.message };
    }
}

module.exports = {
    isConfigured,
    sendPush
};
