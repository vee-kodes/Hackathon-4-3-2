// supabase/functions/get_recipes/index.ts
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
// ✅ Safer CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
serve(async (req)=>{
  // ✅ Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    // ✅ Parse request body safely
    let body;
    try {
      body = await req.json();
    } catch  {
      return new Response(JSON.stringify({
        error: 'Invalid JSON body'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { ingredients, user_id } = body;
    if (!ingredients) {
      return new Response(JSON.stringify({
        error: 'Ingredients are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // ✅ Initialize Supabase client with validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables are not configured');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    // ✅ Log search history (non-blocking)
    if (user_id) {
      const { error: insertError } = await supabase.from('recipe_searches').insert([
        {
          user_id,
          ingredients
        }
      ]);
      if (insertError) {
        console.log('Search logging failed (non-critical):', insertError);
      }
    }
    // ✅ Validate OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    // ✅ Call OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional chef AI assistant specializing in creative recipe generation. 
Given a list of ingredients, suggest 3 unique and delicious recipes that prominently feature those ingredients.

Return ONLY valid JSON in this structure:
[
  {
    "id": "unique_recipe_id_1",
    "name": "Recipe Name",
    "description": "Brief, appetizing description (1-2 sentences max)",
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["step 1", "step 2"]
  }
]`
          },
          {
            role: 'user',
            content: `Create 3 diverse and creative recipes using these ingredients: ${ingredients}`
          }
        ],
        max_tokens: 2500,
        temperature: 0.8,
        top_p: 0.9
      })
    });
    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error('OpenAI API error:', openaiResponse.status, errorText);
      throw new Error(`OpenAI API error: ${openaiResponse.status}`);
    }
    const openaiData = await openaiResponse.json();
    // ✅ Parse and validate the AI response
    let recipes;
    try {
      const content = openaiData?.choices?.[0]?.message?.content;
      if (!content) throw new Error('No content returned from OpenAI');
      const jsonContent = content.replace(/```json\n?|\n?```/g, '').trim();
      recipes = JSON.parse(jsonContent);
      if (!Array.isArray(recipes) || recipes.length === 0) {
        throw new Error('Invalid or empty recipes array');
      }
      // ✅ Ensure structure
      recipes = recipes.map((recipe, index)=>{
        const recipeId = recipe.id || `recipe_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
        return {
          id: recipeId,
          name: recipe.name || `Recipe ${index + 1}`,
          description: recipe.description || 'A delicious recipe for you to try!',
          ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
          instructions: Array.isArray(recipe.instructions) ? recipe.instructions : []
        };
      }).slice(0, 3);
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      console.error('Raw OpenAI content:', openaiData?.choices?.[0]?.message?.content);
      // ✅ Fallback recipe if parsing fails
      const ingredientsList = Array.isArray(ingredients) ? ingredients : String(ingredients).split(',').map((i)=>i.trim());
      recipes = [
        {
          id: `fallback_${Date.now()}_1`,
          name: `${ingredientsList[0] || 'Mixed'} Stir-Fry`,
          description: 'A quick and delicious stir-fry using your ingredients.',
          ingredients: [
            ...ingredientsList,
            'Oil for cooking',
            'Salt and pepper',
            'Garlic (optional)'
          ],
          instructions: [
            'Heat oil in a large pan or wok over medium-high heat.',
            'Add garlic if using and cook for 30 seconds until fragrant.',
            'Add your ingredients, starting with harder vegetables first.',
            'Stir-fry for 3-5 minutes until cooked through.',
            'Season with salt and pepper to taste.',
            'Serve hot over rice or enjoy as is!'
          ]
        }
      ];
    }
    // ✅ Final response
    return new Response(JSON.stringify({
      recipes,
      timestamp: new Date().toISOString(),
      ingredients_used: ingredients
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to generate recipes',
      details: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
