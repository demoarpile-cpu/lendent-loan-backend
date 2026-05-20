require('dotenv').config();
const axios = require('axios');

const appId = (process.env.ONESIGNAL_APP_ID || '').trim();
const apiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();

async function checkKey() {
    console.log('--- Cleaned OneSignal Config ---');
    console.log('App ID:', JSON.stringify(appId));
    console.log('API Key:', JSON.stringify(apiKey));
    console.log('API Key Length:', apiKey.length);

    try {
        console.log('\nFetching App Details...');
        const res = await axios.get(`https://onesignal.com/api/v1/apps/${appId}`, {
            headers: {
                'Authorization': `Key ${apiKey}`
            }
        });
        console.log('App Details Retrieval SUCCESSFUL!');
        console.log('App Name:', res.data.name);
        console.log('Players Count:', res.data.players);
    } catch (err) {
        console.error('App Details Retrieval FAILED!');
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Response Data:', JSON.stringify(err.response.data));
        } else {
            console.error('Error:', err.message);
        }
    }
}

checkKey();
