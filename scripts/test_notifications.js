require('dotenv').config();
const twilioService = require('../services/twilio.service');
const oneSignalService = require('../services/onesignal.service');
const { sendMultiChannel } = require('../services/notification.service');

async function testSms(testPhone) {
    console.log('\n--- Testing SMS ---');
    if (!testPhone) {
        console.log('Skipping SMS test (no phone provided)');
        return;
    }
    const result = await twilioService.sendSms({
        to: testPhone,
        body: 'LendaNet SMS Test: Verification Successful!'
    });
    console.log('SMS Result:', result);
}

async function testEmail(testEmail) {
    console.log('\n--- Testing Email ---');
    if (!testEmail) {
        console.log('Skipping Email test (no email provided)');
        return;
    }
    const result = await twilioService.sendEmail({
        to: testEmail,
        subject: 'LendaNet Email Test',
        text: 'This is a test email from LendaNet.',
        html: '<strong>This is a test email from LendaNet.</strong>'
    });
    console.log('Email Result:', result);
}

async function testPush(testPlayerId) {
    console.log('\n--- Testing Push ---');
    if (!testPlayerId) {
        console.log('Skipping Push test (no playerId provided)');
        return;
    }
    const result = await oneSignalService.sendPush({
        playerIds: [testPlayerId],
        headings: 'LendaNet Test',
        contents: 'Test push notification content'
    });
    console.log('Push Result:', result);
}

async function runTests() {
    console.log('Starting Notification System Check...');
    
    // Check Config Status
    console.log('\n--- Configuration Status ---');
    console.log('Twilio (SMS/Email):', twilioService.isConfigured() ? '✅ Configured' : '❌ Not Configured');
    console.log('OneSignal (Push):', oneSignalService.isConfigured() ? '✅ Configured' : '❌ Not Configured');
    
    // Get test data from command line or env
    const testPhone = process.argv[2] || process.env.TEST_PHONE;
    const testEmailAddr = process.argv[3] || process.env.TEST_EMAIL;
    const testPlayerId = process.argv[4] || process.env.TEST_PLAYER_ID;

    if (!testPhone && !testEmailAddr && !testPlayerId) {
        console.log('\nUsage: node scripts/test_notifications.js [phone] [email] [playerId]');
        console.log('Example: node scripts/test_notifications.js +260971234567 test@example.com 1234-5678-90ab');
    }

    await testSms(testPhone);
    await testEmail(testEmailAddr);
    await testPush(testPlayerId);

    console.log('\n--- Multi-Channel Logic Test ---');
    if (testPhone || testEmailAddr || testPlayerId) {
        const multiResult = await sendMultiChannel({
            phone: testPhone,
            email: testEmailAddr,
            oneSignalPlayerId: testPlayerId,
            smsBody: 'LendaNet Multi-Channel Test SMS',
            emailSubject: 'LendaNet Multi-Channel Test Email',
            emailText: 'This is a multi-channel test email.',
            pushTitle: 'Multi-Channel Push',
            pushBody: 'This is a multi-channel test push.'
        });
        console.log('Multi-Channel Result:', JSON.stringify(multiResult, null, 2));
    }

    console.log('\nCheck complete.');
}

runTests().catch(err => {
    console.error('Test Execution Error:', err);
});
