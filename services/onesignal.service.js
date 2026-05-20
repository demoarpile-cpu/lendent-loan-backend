const OneSignal = require('onesignal-node');

const appId = (process.env.ONESIGNAL_APP_ID || '').trim();
const apiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();

// Local testing flag
const mockNotifications = process.env.MOCK_NOTIFICATIONS === 'true';

let client = null;
if (appId && apiKey && !appId.includes('YOUR_') && !apiKey.includes('YOUR_')) {
    try {
        client = new OneSignal.Client(appId, apiKey);
    } catch (e) {
        console.warn('⚠️ [OneSignal] Initialization failed:', e.message);
    }
}

function isConfigured() {
    return Boolean(client) || mockNotifications;
}

// Gorgeous ASCII box printer for mock push notifications
function printMockPush(playerIds, headings, contents, email) {
    const border = '═'.repeat(60);
    console.log('\n\x1b[34m╔' + border + '╗');
    console.log('║ \x1b[1m\x1b[33m📱 [MOCK PUSH NOTIFICATION DISPATCHED]\x1b[0m' + ' '.repeat(20) + '\x1b[34m║');
    console.log('╠' + border + '╣');
    console.log(`║ \x1b[1mPlayer IDs:\x1b[0m ${JSON.stringify(playerIds).padEnd(46)} \x1b[34m║`);
    if (email) {
        console.log(`║ \x1b[1mTarget Email:\x1b[0m ${email.padEnd(45)} \x1b[34m║`);
    }
    console.log(`║ \x1b[1mTitle:\x1b[0m ${headings.padEnd(51)} \x1b[34m║`);
    console.log('╠' + border + '╣');
    
    const bodyLines = contents.match(/.{1,54}/g) || [contents];
    bodyLines.forEach(line => {
        console.log(`║ \x1b[32m${line.padEnd(54)}\x1b[0m \x1b[34m║`);
    });
    console.log('╚' + border + '╝\x1b[0m\n');
}

async function sendPush({ playerIds = [], headings = 'LendaNet', contents, email = null }) {
    const targetPlayerIds = playerIds.filter(Boolean);

    // Support local mock mode
    if (mockNotifications || !client) {
        printMockPush(targetPlayerIds, headings, contents, email);
        return { ok: true, mock: true };
    }

    if (!targetPlayerIds.length && !email) {
        return { ok: false, reason: 'No player ids or email provided' };
    }
    if (!contents) {
        return { ok: false, reason: 'Missing push content' };
    }

    try {
        const payload = {
            headings: { en: headings },
            contents: { en: contents }
        };

        if (targetPlayerIds.length > 0) {
            payload.include_player_ids = targetPlayerIds;
        }

        if (email) {
            payload.filters = [{ field: 'email', value: email }];
        }

        console.log(`[OneSignal] Dispatching notification to ${targetPlayerIds.length} devices...`);
        const response = await client.createNotification(payload);
        console.log('[OneSignal] Notification successfully queued.');
        return { ok: true, response };
    } catch (error) {
        console.error(`[OneSignal] Notification delivery failed: ${error.message}`);
        
        // Graceful fallback representation in terminal
        console.log('ℹ️ [OneSignal Fallback] Falling back to Console Log representation...');
        printMockPush(targetPlayerIds, headings, contents, email);
        return { ok: true, fallback: true, reason: error.message };
    }
}

module.exports = {
    isConfigured,
    sendPush
};
