// api/stripe-webhook.js

import Stripe from 'stripe';
import axios from 'axios';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

export const config = {
  api: {
    bodyParser: false,
  },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    req.on('data', (chunk) => {
      buffer += chunk;
    });
    req.on('end', () => {
      resolve(buffer);
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

const addToWixContacts = async (customerData) => {
  const { email, firstName, lastName } = customerData;

  const contactData = {
    contact: {
      info: {
        emails: [
          {
            email,
            primary: true,
          },
        ],
        name: {
          first: firstName,
          last: lastName,
        },
        phones: [], // Must be present to avoid "info must not be empty"
      },
      labels: ["Stripe MTHD RT 2025"],
    },
  };

  console.info("Contact data to send:", JSON.stringify(contactData, null, 2));

  try {
    const response = await axios.post(
      'https://www.wixapis.com/contacts/v4/contacts',
      contactData,
      {
        headers: {
          Authorization: process.env.WIX_API_KEY,
          'Content-Type': 'application/json',
          'wix-site-id': process.env.WIX_SITE_ID,
        },
      }
    );
    console.info("Wix create response:", response.data);
    return response.data;
  } catch (error) {
    console.info("Wix create error details:", error.response?.data || error.message);
    throw new Error(`Wix create error: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
  }
};

const handler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  const buf = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (
      session.mode === 'payment' &&
      session.metadata?.product_id === 'prod_Shc5isiU1QCROZ' &&
      session.metadata?.price_id === 'price_1RmCqtEzVzn8BmhmeTZtvJmQ'
    ) {
      const email = session.customer_details.email;
      const nameParts = session.customer_details.name?.split(' ') || [''];
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || '';

      const customerData = {
        email,
        firstName,
        lastName,
        phone: '',
        purchaseAmount: 0,
        purchaseDate: new Date().toISOString(),
        stripeSessionId: session.id,
      };

      console.info("Webhook received for session:", session.id);
      console.info("Customer email:", email);
      console.info("Extracted names - First:", firstName, "Last:", lastName);
      console.info("Attempting to create contact in Wix with data:", customerData);

      try {
        await addToWixContacts(customerData);
        return res.status(200).json({ received: true });
      } catch (error) {
        console.error("Error managing contact in Wix:", error);
        return res.status(500).send(`Webhook error: ${error.message}`);
      }
    } else {
      console.info("Session does not match required product.");
    }
  }

  res.status(200).json({ received: true });
};

export default handler;
