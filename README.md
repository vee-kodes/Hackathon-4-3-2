## Hackathon-4-3-2

# 🍳 SavorAI – AI Recipe Recommender
SavorAI is a recipe search web app with a **free tier** and **Pro upgrade** using **IntaSend payments**.  
Built with **Supabase** for backend + database, **Edge Functions** for business logic, and **OpenAI** for AI-powered recipe generation.  


## 🛠️ Tech Stack
- **Frontend**: HTML, CSS, JavaScript  
- **Hosting**: Netlify (serves static frontend)  
- **Backend**: Supabase  (cloud-hosted Postgres database + backend services)
  - **Postgres Database** (stores users, recipes, favorites, & payment status)  
  - **Edge Functions** (custom backend logic with Deno/TypeScript)  
- **AI**: OpenAI API (recipe generation from ingredients)  
- **Payments**: IntaSend API (checkout links)  


## 🌐 Hosting & Integration
- The **frontend** is deployed on **Netlify**.  
- The **backend** (database + edge functions) is fully managed by **Supabase**.  
- The frontend connects directly to Supabase using the **Supabase URL** and **anon key** in `app.js`.  
- Supabase **Row Level Security (RLS)** ensures users only access their own data.  
- **Edge Functions** bridge external services:  
  - Recipe generation (OpenAI)  
  - Payment checkout (IntaSend)  



## 💳 Payments (IntaSend Integration)
- Free tier: **3 recipe searches per user**  
- On exceeding the limit, user is prompted with an **upgrade modal**  
- The `create-checkout` Edge Function generates an **IntaSend payment link**  
- Users are redirected to the IntaSend checkout page  


## 🚀 Live Deployment
- Netlify Deployment: https://savorai.netlify.app
- Backend: Hosted on Supabase (database + edge functions)  


## 🏗️ System Architecture

```
flowchart TD
    U[👤 User] --> N[🌐 Netlify (Frontend)]
    N --> S[🗄️ Supabase Database]
    N --> F[⚡ Supabase Edge Functions]
    F --> O[🤖 OpenAI (AI Recipes)]
    F --> P[💳 IntaSend (Payments)]
    S -->|Stores| SF[📂 Users & Favorites]
    U -->|Free (3 recipes)| N
    U -->|Upgrade (Pro)| P


- User opens app via Netlify.  
- Frontend connects to Supabase Database (for users & favorites).  
- Frontend calls Edge Functions → which talk to OpenAI (recipes) and IntaSend (payments).  
- Free users get 3 recipes → then can upgrade via IntaSend.    
```


## ⚡ Supabase Edge Functions
- `get-recipes`: Uses **OpenAI** to generate recipes based on user input (ingredients).  
- `create-checkout`: Generates **IntaSend** payment checkout links.  


## 🔐 Database Security (RLS Policies)
Row Level Security (RLS) is enabled on all tables to ensure data safety:
- **recipes**  
  - Publicly readable so anyone can search recipes. 
  - Writes are restricted to system/Edge Functions (for AI-generated recipes).  
  - Matches the app flow: visitors can browse up to 3 free recipes before being prompted to upgrade via IntaSend.  

- **favorites**  
  - Fully protected with RLS.  
  - Users can only `SELECT`, `INSERT`, `UPDATE`, or `DELETE` their **own favorites** (`auth.uid() = user_id`).  

- **users**  
  - Each user can only view or update **their own profile row** (`auth.uid() = id`).  
  - Prevents unauthorized access to other users’ data.  

## 🗂️ Project Structure

```
├── index.html        # Main HTML file
├── style.css         # Styling
├── app.js            # Core JavaScript logic (includes Supabase client setup)
├── supabase/
│   └── functions/
│       ├── get-recipes/        # Fetch recipes (Edge Function)
│       │   └── index.ts
│       └── create-checkout/    # IntaSend checkout (Edge Function)
│           └── index.ts
└── README.md
```

## 📌 Roadmap
- ✅ Free tier enforcement (3 free recipe searches)  
- ✅ OpenAI integration for AI-powered recipes  
- ✅ IntaSend checkout integration via Edge Functions  
- ⏳ Save user payment status in Supabase DB  
