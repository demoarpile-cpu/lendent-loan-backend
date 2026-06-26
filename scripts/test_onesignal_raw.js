require('dotenv').config();
const axios = require('axios');

const appId = process.env.ONESIGNAL_APP_ID;
const apiKey = process.env.ONESIGNAL_REST_API_KEY;

async function testOneSignalAuth() {
    console.log('App ID:', appId);
    console.log('API Key length:', apiKey ? apiKey.length : 0);
    console.log('API Key prefix:', apiKey ? apiKey.substring(0, 15) : 'none');

    const payload = {
        app_id: appId,
        headings: { en: 'LendaNet Test' },
        contents: { en: 'Direct API Test Notification' },
        included_segments: ['Subscribed Users']
    };

    // Test 1: Basic Authentication
    console.log('\n--- Test 1: Authorization: Basic <key> ---');
    try {
        const res = await axios.post('https://onesignal.com/api/v1/notifications', payload, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Basic ${apiKey}`
            }
        });
        console.log('Test 1 Success! Response ID:', res.data.id);
    } catch (err) {
        console.error('Test 1 Failed:', err.response ? err.response.status : err.message);
        if (err.response && err.response.data) {
            console.error('Response details:', JSON.stringify(err.response.data));
        }
    }

    // Test 2: Bearer Authentication
    console.log('\n--- Test 2: Authorization: Bearer <key> ---');
    try {
        const res = await axios.post('https://onesignal.com/api/v1/notifications', payload, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${apiKey}`
            }
        });
        console.log('Test 2 Success! Response ID:', res.data.id);
    } catch (err) {
        console.error('Test 2 Failed:', err.response ? err.response.status : err.message);
        if (err.response && err.response.data) {
            console.error('Response details:', JSON.stringify(err.response.data));
        }
    }

    // Test 3: Key Authentication (Key <key>)
    console.log('\n--- Test 3: Authorization: Key <key> ---');
    try {
        const res = await axios.post('https://onesignal.com/api/v1/notifications', payload, {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Key ${apiKey}`
            }
        });
        console.log('Test 3 Success! Response ID:', res.data.id);
    } catch (err) {
        console.error('Test 3 Failed:', err.response ? err.response.status : err.message);
        if (err.response && err.response.data) {
            console.error('Response details:', JSON.stringify(err.response.data));
        }
    }
}

testOneSignalAuth();
