// supabase/functions/create-checkout/index.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
// ✅ CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { user_id, plan } = await req.json();
    if (!user_id || !plan) {
      return new Response(JSON.stringify({
        error: "Missing user_id or plan"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ✅ Get IntaSend secret key from Supabase environment
    const INTASEND_SECRET_KEY = Deno.env.get("INTASEND_SECRET_KEY");
    if (!INTASEND_SECRET_KEY) {
      throw new Error("IntaSend secret key not configured in environment");
    }
    // ✅ Plan pricing
    const planPrices = {
      pro: 500
    };
    const amount = planPrices[plan];
    if (!amount) {
      return new Response(JSON.stringify({
        error: "Invalid plan selected"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // ✅ Payload for IntaSend Checkout API (sandbox-ready)
    const payload = {
      first_name: "Test",
      last_name: "User",
      email: `${user_id}@example.com`,
      amount,
      currency: "KES",
      api_ref: `savorai_${Date.now()}`,
      redirect_url: "http://127.0.0.1:5500/public/payment-success.html",
      callback_url: "http://127.0.0.1:5500/public/payment-callback.html",
      hosted: true
    };
    console.log("🚀 Sending payload to IntaSend:", payload);
    // ✅ Call IntaSend Checkout API (sandbox)
    const response = await fetch("https://sandbox.intasend.com/api/v1/checkout/", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INTASEND_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log("✅ IntaSend response:", data);
    if (!response.ok) {
      throw new Error(`IntaSend error: ${JSON.stringify(data)}`);
    }
    // ✅ Return checkout URL to frontend
    return new Response(JSON.stringify({
      checkout_url: data.url
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Checkout failed"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
