import axios from 'axios';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const event = req.body;

    // Extract customer info example:
    const email = event.data?.object?.customer_email || '';
    const firstName = event.data?.object?.customer_details?.first_name || 'First';
    const lastName = event.data?.object?.customer_details?.last_name || 'Last';

    const contactData = {
      contact: {
        info: {
          emails: [
            {
              email: email,
              primary: true,
            },
          ],
          name: {
            first: firstName,
            last: lastName,
          },
        },
        labels: ['Stripe MTHD RT 2025'],
      },
    };

    // Replace with your Wix API URL and auth
    const wixUrl = 'https://www.wixapis.com/crm/v1/contacts';
    const wixApiKey = process.env.WIX_API_KEY;

    const response = await axios.post(wixUrl, contactData, {
      headers: {
        Authorization: `Bearer ${wixApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
