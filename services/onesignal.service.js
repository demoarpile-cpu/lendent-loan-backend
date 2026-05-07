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

async function sendPush({ playerIds = [], headings = 'LendaNet', contents }) {
    if (!client) return { ok: false, reason: 'OneSignal is not configured' };
    if (!playerIds.length) return { ok: false, reason: 'No player ids provided' };
    if (!contents) return { ok: false, reason: 'Missing push content' };

    try {
        const response = await client.createNotification({
            include_player_ids: playerIds,
            headings: { en: headings },
            contents: { en: contents }
        });
        return { ok: true, response };
    } catch (error) {
        return { ok: false, reason: error.message };
    }
}

module.exports = {
    isConfigured,
    sendPush
};
