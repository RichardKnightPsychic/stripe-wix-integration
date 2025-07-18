const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buffer } = require('micro');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send({ message: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  if (!sig) {
    return res.status(400).send({ error: 'Missing Stripe signature' });
  }

  let rawBody;
  try {
    rawBody = await buffer(req);
  } catch (err) {
    console.error('Error reading request body:', err);
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

    // Fetch line items to check products
    let sessionWithLineItems;
    try {
      sessionWithLineItems = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['line_items'],
      });
    } catch (error) {
      console.error('Error fetching session line items:', error);
      return res.status(500).send('Error fetching session line items');
    }

    const lineItems = sessionWithLineItems.line_items.data;

    const wantedProductId = 'prod_Shc5isiU1QCROZ';
    const wantedPriceId = 'price_1RmCqtEzVzn8BmhmeTZtvJmQ';

    const boughtRelevantProduct = lineItems.some((item) => {
      return item.price.product === wantedProductId || item.price.id === wantedPriceId;
    });

    if (!boughtRelevantProduct) {
      console.log('Product purchased does not match specified IDs; ignoring.');
      return res.status(200).send({ received: true });
    }

    // Extract customer info
    const customerEmail = session.customer_details?.email || session.customer_email;
    const customerName = session.customer_details?.name || '';

    if (!customerEmail) {
      console.warn('No customer email found in session.');
      return res.status(400).send({ error: 'No customer email in session' });
    }

    // Prepare Wix contact payload
    const contactPayload = {
      emails: [{ email: customerEmail, tag: 'Primary' }],
      firstName: customerName.split(' ')[0] || '',
      lastName: customerName.split(' ').slice(1).join(' ') || '',
      labels: ['Stripe MTHD RT 2025'],
    };

    try {
      const wixResponse = await fetch('https://www.wixapis.com/crm/v1/contacts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.WIX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contactPayload),
      });

      if (!wixResponse.ok) {
        const errorBody = await wixResponse.text();
        console.error('Wix API error:', errorBody);
        return res.status(500).send({ error: 'Error adding/updating contact in Wix' });
      }
    } catch (error) {
      console.error('Error communicating with Wix API:', error);
      return res.status(500).send({ error: 'Error communicating with Wix' });
    }

    console.log('✅ Wix contact added/updated for:', customerEmail);
  } else {
    console.log(`Unhandled event type: ${event.type}`);
  }

  res.status(200).send({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
