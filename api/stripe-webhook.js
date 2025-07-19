const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const buffer = require('micro').buffer;
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send({ message: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let rawBody;

  try {
    rawBody = await buffer(req);
  } catch (err) {
    return res.status(500).send({ error: 'Failed to read request body' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('⚠️ Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('✅ Checkout session completed:', session);

    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerName = session.customer_details?.name || '';
    if (!customerEmail) {
      console.warn('No customer email found, skipping Wix contact creation.');
      return res.status(200).send({ received: true });
    }

    // Split name into first and last
    const [firstName, ...lastNameParts] = customerName.split(' ');
    const lastName = lastNameParts.join(' ');

    const wixApiKey = process.env.WIX_API_KEY;
    const wixBaseUrl = 'https://www.wixapis.com/crm/v1/contacts';

    try {
      // 1. Search for contact by email
      const searchRes = await axios.post(
        `${wixBaseUrl}/search/email`,
        { email: customerEmail },
        { headers: { Authorization: `Bearer ${wixApiKey}`, 'Content-Type': 'application/json' } }
      );

      if (searchRes.data.contacts && searchRes.data.contacts.length > 0) {
        // Contact exists — update it
        const existingContact = searchRes.data.contacts[0];
        const contactId = existingContact._id;

        // Prepare update payload — add label (tag)
        const updatePayload = {
          labels: existingContact.labels || [],
          emails: existingContact.emails || [{ email: customerEmail, tag: 'Primary' }],
          firstName: firstName || '',
          lastName: lastName || '',
        };

        // Add the label only if not already present
        if (!updatePayload.labels.includes('Stripe MTHD RT 2025')) {
          updatePayload.labels.push('Stripe MTHD RT 2025');
        }

        await axios.patch(
          `${wixBaseUrl}/${contactId}`,
          updatePayload,
          { headers: { Authorization: `Bearer ${wixApiKey}`, 'Content-Type': 'application/json' } }
        );

        console.log(`✅ Wix contact updated for: ${customerEmail}`);

      } else {
        // Contact does NOT exist — create new
        const createPayload = {
          emails: [{ email: customerEmail, tag: 'Primary' }],
          firstName: firstName || '',
          lastName: lastName || '',
          labels: ['Stripe MTHD RT 2025'],
        };

        await axios.post(
          wixBaseUrl,
          createPayload,
          { headers: { Authorization: `Bearer ${wixApiKey}`, 'Content-Type': 'application/json' } }
        );

        console.log(`✅ Wix contact created for: ${customerEmail}`);
      }
    } catch (error) {
      console.error('❌ Error syncing contact with Wix:', error.response?.data || error.message);
    }
  } else {
    console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).send({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};
