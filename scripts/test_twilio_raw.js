require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const smsFrom = process.env.TWILIO_SMS_FROM;
const smsAlpha = process.env.TWILIO_SMS_ALPHA_SENDER;

async function testTwilioAuth() {
    console.log('Account SID:', accountSid);
    console.log('Auth Token length:', authToken ? authToken.length : 0);
    console.log('SMS From:', smsFrom);
    console.log('SMS Alpha Sender:', smsAlpha);

    if (!accountSid || !authToken) {
        console.error('Twilio credentials missing!');
        return;
    }

    const client = twilio(accountSid, authToken);

    console.log('\n--- Testing Twilio Credentials ---');
    try {
        // Retrieve account info to verify auth
        const account = await client.api.v2010.accounts(accountSid).fetch();
        console.log('Authentication Successful! Account Name:', account.friendlyName);
        console.log('Account Status:', account.status);
    } catch (err) {
        console.error('Twilio Authentication Failed:', err.message);
    }
}

testTwilioAuth();
