// SUPABASE CONFIGURATION
const SUPABASE_URL = 'https://wcyteslzlckzuuigzqsr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjeXRlc2x6bGNrenV1aWd6cXNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NTYxNDMsImV4cCI6MjA3MjEzMjE0M30.mB5vdjZSZy29GFlucNQmENxEnreVP1m1idVhkKD4TIQ'; 


// Ensure the supabase client lib is loaded (window.supabase must exist)
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('Supabase JS library not found. Supabase features will fall back to localStorage.');
}

const supabase = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;


// Free-tier usage tracking (lifetime, not daily)
const FREE_RECIPE_LIMIT = 3; // only 3 searches total before upgrade

function getUserRecipeCount() {
    return parseInt(localStorage.getItem("savorai_recipe_count") || "0", 10);
}

function incrementUserRecipeCount() {
    const count = getUserRecipeCount() + 1;
    localStorage.setItem("savorai_recipe_count", count);
    return count;
}

// Test connection on load
async function testSupabaseConnection() {
    if (!supabase) return false;

    try {
        // Request something cheap to verify connectivity. Use '*' with exact count.
        const { data, error, count } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: false })
            .limit(1);

        if (error) {
            console.error('Supabase connection error:', error);
            return false;
        }
        console.log('✅ Supabase appears reachable. Users sample:', data);
        return true;
    } catch (err) {
        console.error('❌ Supabase connection failed:', err);
        return false;
    }
}

// Application State Management
class SavorAI {
    constructor() {
        this.currentView = 'search';
        this.currentRecipes = [];
        this.favorites = [];
        this.userID = null; // locally generated anon id
        this.userUUID = null; // DB UUID for the user (from RPC)
        this.isSupabaseConnected = false;

        // track if user has upgraded
        this.isProUser = false;

        // Bind methods where needed (optional but safe)
        this.toggleFavorite = this.toggleFavorite.bind(this);
        this.toggleRecipeDetails = this.toggleRecipeDetails.bind(this);

        this.initializeApp();
    }

    // Initialize the application
    async initializeApp() {
        // Test Supabase connection
        this.isSupabaseConnected = await testSupabaseConnection();

        // Generate/get user ID
        this.userID = this.generateUserID();

        // Initialize or get user in database (sets userUUID)
        await this.initializeUser();

        // Load user's favorites (from DB if possible)
        await this.loadFavoritesFromDatabase();

        // Set up event listeners (forms, nav)
        this.initializeEventListeners();

        console.log('🚀 SavorAI initialized with user:', this.userID, 'db uuid:', this.userUUID);
    }

    // Initialize user in database
    async initializeUser() {
        if (!this.isSupabaseConnected || !supabase) {
            console.warn('Supabase not connected, using local storage only for user');
            return;
        }

        try {
            // Example: calling an RPC that returns a user object or id. Defensive handling:
            const { data, error } = await supabase.rpc('get_or_create_user', {
                anon_id: this.userID
            });

            if (error) {
                console.error('Error initializing user via RPC:', error);
                return;
            }

            // RPC may return an object or scalar — normalize it:
            if (!data) {
                console.warn('RPC returned no data for user initialization');
                return;
            }

            // If RPC returns an object with id, use it; otherwise, use the raw value
            this.userUUID = (data.id) ? data.id : data;
            console.log('✅ User initialized with UUID:', this.userUUID);
        } catch (error) {
            console.error('Failed to initialize user:', error);
        }
    }

    // Generate anonymous user ID
    generateUserID() {
        let userID = localStorage.getItem('savorai_user_id');
        if (!userID) {
            userID = 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
            localStorage.setItem('savorai_user_id', userID);
        }
        return userID;
    }

    // Initialize Event Listeners
    initializeEventListeners() {
        const form = document.getElementById('recipe-search-form');
        const navSearch = document.getElementById('nav-search');
        const navFavorites = document.getElementById('nav-favorites');
        const backButton = document.getElementById('back-button');
        const logo = document.querySelector('.logo');

        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleRecipeSearch();
            });
        }

        if (navSearch) {
            navSearch.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSearchView();
            });
        }
        if (navFavorites) {
            navFavorites.addEventListener('click', (e) => {
                e.preventDefault();
                this.showFavoritesView();
            });
        }
        if (backButton) {
            backButton.addEventListener('click', () => this.handleBackToSearch());
        }
        if (logo) {
            logo.addEventListener('click', (e) => {
                e.preventDefault();
                this.showSearchView();
            });
        }
    }

// Handle Recipe Search (calls Supabase Edge Function when available)
async handleRecipeSearch() {
    const ingredientsInput = document.getElementById('ingredients-input');
    if (!ingredientsInput) return this.showError('Ingredients input not found in DOM');

    const ingredients = ingredientsInput.value.trim();
    if (!ingredients) {
        this.showError('Please enter some ingredients!');
        return;
    }

    // Free-tier enforcement (lifetime, not daily)
    if (!this.isProUser) {
        const count = getUserRecipeCount();
        if (count >= FREE_RECIPE_LIMIT) {
            this.showUpgradePrompt(); // show upgrade modal
            return;
        }
        incrementUserRecipeCount(); // ✅ only increment AFTER passing the limit check
    }

    // Show loading state
    this.setLoadingState(true);
    this.hideError();

    try {
        // Use the Supabase function if available; fallback to mock
        const recipes = await this.fetchRecipesFromSupabase(ingredients);
        this.displayRecipes(recipes, ingredients);
        this.showResultsView();
    } catch (error) {
        console.error('Error fetching recipes:', error);
        this.showError('Failed to fetch recipes. Please try again.');
    } finally {
        this.setLoadingState(false);
    }
}

    // Fetch Recipes from Supabase Edge Function
    async fetchRecipesFromSupabase(ingredients) {
        if (!this.isSupabaseConnected || !supabase) {
            console.warn('Supabase not connected or client missing - using mock data');
            return this.getMockRecipes();
        }

        try {
            // supabase.functions.invoke expects the body to be a stringified JSON
            const body = JSON.stringify({
                ingredients,
                user_id: this.userID,
                user_uuid: this.userUUID
            });

            // Choose the correct API for your supabase client. This is typical:
            const res = await supabase.functions.invoke('get_recipes', { body });

            // supabase.functions.invoke returns an object. Typically res.data is parsed already.
            // Be defensive about the shape:
            if (!res || res.error) {
                console.error('Supabase function returned error:', res?.error);
                throw new Error(res?.error?.message || 'Error calling Supabase function');
            }

            const data = res.data ?? res; // support both shapes
            // Expect data.recipes to be an array; fallback to data if it *is* an array
            const recipes = Array.isArray(data.recipes) ? data.recipes : (Array.isArray(data) ? data : []);

            if (!Array.isArray(recipes)) {
                throw new Error('Invalid response format from server');
            }

            console.log('✅ Recipes fetched from Supabase:', recipes.length);
            return recipes;
        } catch (error) {
            console.error('Error calling Supabase Edge Function:', error);

            // Config fallback
            if (SUPABASE_URL === 'https://wcyteslzlckzuuigzqsr.supabase.co') {
                console.warn('⚠️ Supabase not configured - using mock data');
                return this.getMockRecipes();
            }

            // As a last resort, fallback to mock data rather than failing silently:
            return this.getMockRecipes();
        }
    }

    // Upgrade Modal with IntaSend Checkout
       showUpgradePrompt() {
        const modal = document.createElement("div");
        modal.className = "upgrade-modal";
        modal.innerHTML = `
            <div class="upgrade-content">
                <h2>Upgrade to Pro</h2>
                <p>You’ve reached the free limit of ${FREE_RECIPE_LIMIT} recipe searches.</p>
                <button id="upgrade-btn">Upgrade Now</button>
                <button id="close-upgrade">Maybe later</button>
            </div>
        `;
        document.body.appendChild(modal);

        // Close modal
        modal.querySelector("#close-upgrade").addEventListener("click", () => {
            modal.remove();
        });

        // Trigger IntaSend checkout (Edge Function)
        modal.querySelector("#upgrade-btn").addEventListener("click", async () => {
            try {
                const res = await fetch("https://wcyteslzlckzuuigzqsr.supabase.co/functions/v1/create-checkout", 
                    {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    },
                    body: JSON.stringify({
                        user_id: this.userUUID || this.userID,
                        plan: "pro",
                    }),
                    }
                );

                if (!res.ok) throw new Error("Checkout request failed");
                const { checkout_url } = await res.json();

                window.location.href = checkout_url; // redirect
            } catch (err) {
                console.error("Failed to start checkout:", err);
                alert("Payment failed to start. Please try again later.");
            }
        });
    }


    // Mock data fallback recipes
    getMockRecipes() {
        return [
            {
                id: 'recipe_1',
                name: 'Fluffy Cheese Scrambled Eggs',
                description: 'Creamy, restaurant-quality scrambled eggs with a perfect cheese melt that will make your breakfast unforgettable.',
                ingredients: [
                    '4 large eggs',
                    '1/4 cup shredded cheese (cheddar or gruyere)',
                    '2 tablespoons butter',
                    '2 tablespoons heavy cream',
                    'Salt and pepper to taste',
                    'Fresh chives for garnish'
                ],
                instructions: [
                    'Crack eggs into a bowl and whisk with cream, salt, and pepper until well combined.',
                    'Heat butter in a non-stick pan over medium-low heat until melted and foaming.',
                    'Pour in the egg mixture and let it sit for 20 seconds without stirring.',
                    'Using a spatula, gently push the edges toward the center, tilting the pan to let uncooked egg flow underneath.',
                    'Continue this process for 2-3 minutes until eggs are almost set but still slightly wet.',
                    'Remove from heat and immediately sprinkle cheese over the eggs.',
                    'Gently fold the cheese in and let residual heat melt it completely.',
                    'Garnish with fresh chives and serve immediately on warm plates.'
                ]
            },
            {
                id: 'recipe_2',
                name: 'Crispy Cheese Pancakes',
                description: 'Golden pancakes with cheese incorporated into the batter for a savory-sweet twist that\'s perfect for brunch.',
                ingredients: [
                    '1 cup all-purpose flour',
                    '2 large eggs',
                    '1 cup milk',
                    '1/2 cup shredded cheese',
                    '2 tablespoons melted butter',
                    '1 tablespoon sugar',
                    '1 teaspoon baking powder',
                    '1/2 teaspoon salt'
                ],
                instructions: [
                    'In a large bowl, whisk together flour, baking powder, sugar, and salt.',
                    'In another bowl, beat eggs, then add milk and melted butter.',
                    'Pour wet ingredients into dry ingredients and stir until just combined - don\'t overmix.',
                    'Fold in the shredded cheese gently.',
                    'Heat a non-stick pan or griddle over medium heat and lightly grease.',
                    'Pour 1/4 cup of batter for each pancake onto the hot surface.',
                    'Cook until bubbles form on surface and edges look set, about 2-3 minutes.',
                    'Flip and cook until golden brown on the other side, about 1-2 minutes more.',
                    'Serve hot with butter, syrup, or your favorite toppings.'
                ]
            },
            {
                id: 'recipe_3',
                name: 'Simple Cheese Soufflé',
                description: 'An elegant, airy soufflé that rises beautifully and delivers incredible flavor with minimal ingredients.',
                ingredients: [
                    '4 large eggs, separated',
                    '1 cup grated cheese (gruyere or parmesan)',
                    '3 tablespoons all-purpose flour',
                    '3 tablespoons butter',
                    '1 cup warm milk',
                    '1/4 teaspoon nutmeg',
                    'Salt and white pepper to taste',
                    'Butter for ramekins'
                ],
                instructions: [
                    'Preheat oven to 375°F (190°C). Butter 4 ramekins and dust with grated cheese.',
                    'Melt butter in a saucepan, whisk in flour and cook for 1 minute to make a roux.',
                    'Gradually add warm milk, whisking constantly until smooth and thickened.',
                    'Remove from heat, stir in cheese, nutmeg, salt, and pepper until cheese melts.',
                    'Let cool slightly, then beat in egg yolks one at a time.',
                    'In a clean bowl, whip egg whites until stiff peaks form.',
                    'Fold 1/3 of egg whites into cheese mixture to lighten, then gently fold in remaining whites.',
                    'Divide mixture among prepared ramekins, filling them 3/4 full.',
                    'Bake for 20-25 minutes until puffed and golden. Serve immediately!'
                ]
            }
        ];
    }

    // Display Recipes
    displayRecipes(recipes, searchIngredients) {
        this.currentRecipes = recipes || [];
        const grid = document.getElementById('recipes-grid');
        const resultsSubtitle = document.querySelector('.results-subtitle');

        if (resultsSubtitle) {
            resultsSubtitle.textContent = `Here are some delicious recipes using: ${searchIngredients}`;
        }
        if (!grid) return;

        grid.innerHTML = '';

        recipes.forEach(recipe => {
            const card = this.createRecipeCard(recipe);
            grid.appendChild(card);
        });
    }

    // Create Recipe Card Element (with event listeners)
    createRecipeCard(recipe) {
        const card = document.createElement('div');
        card.className = 'recipe-card';
        card.dataset.recipeId = recipe.id;

        const isFavorited = this.favorites.some(fav => fav.id === recipe.id);

        card.innerHTML = `
            <div class="recipe-card-header">
                <h3 class="recipe-title">${this._escapeHTML(recipe.name)}</h3>
                <p class="recipe-description">${this._escapeHTML(recipe.description || '')}</p>
            </div>
            <div class="recipe-card-actions">
                <button class="expand-btn">View Recipe</button>
                <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" data-recipe-id="${recipe.id}">
                    <span>♥</span>
                    <span>${isFavorited ? 'Favorited' : 'Save Favorite'}</span>
                </button>
            </div>
            <div class="recipe-details" id="details-${recipe.id}">
                <div class="ingredients-section">
                    <h4 class="section-title">Ingredients</h4>
                    <ul class="ingredients-list">
                        ${Array.isArray(recipe.ingredients) ? recipe.ingredients.map(ingredient => `<li>${this._escapeHTML(ingredient)}</li>`).join('') : ''}
                    </ul>
                </div>
                <div class="instructions-section">
                    <h4 class="section-title">Instructions</h4>
                    <ol class="instructions-list">
                        ${Array.isArray(recipe.instructions) ? recipe.instructions.map(instruction => `<li>${this._escapeHTML(instruction)}</li>`).join('') : ''}
                    </ol>
                </div>
            </div>
        `;

        // Attach event listeners (safer than inline onclick)
        const expandBtn = card.querySelector('.expand-btn');
        const favoriteBtn = card.querySelector('.favorite-btn');

        if (expandBtn) {
            expandBtn.addEventListener('click', () => this.toggleRecipeDetails(recipe.id));
        }
        if (favoriteBtn) {
            favoriteBtn.addEventListener('click', () => this.toggleFavorite(recipe.id));
        }

        return card;
    }

    // Simple HTML sanitizer for small texts
    _escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Toggle Recipe Details
    toggleRecipeDetails(recipeId) {
        const details = document.getElementById(`details-${recipeId}`);
        if (!details) return;

        const actions = details.previousElementSibling; // recipe-card-actions
        const expandBtn = actions ? actions.querySelector('.expand-btn') : null;

        if (details.classList.contains('show')) {
            details.classList.remove('show');
            if (expandBtn) expandBtn.textContent = 'View Recipe';
        } else {
            // Close other details
            document.querySelectorAll('.recipe-details.show').forEach(detail => {
                detail.classList.remove('show');
                const prev = detail.previousElementSibling;
                if (prev) {
                    const btn = prev.querySelector('.expand-btn');
                    if (btn) btn.textContent = 'View Recipe';
                }
            });

            details.classList.add('show');
            if (expandBtn) expandBtn.textContent = 'Hide Recipe';
        }
    }

    // Toggle Favorite
    async toggleFavorite(recipeId) {
        // Find recipe either in current results or in favorites
        const recipe = this.currentRecipes.find(r => r.id === recipeId) ||
                       this.favorites.find(f => f.id === recipeId);

        if (!recipe) {
            console.warn('Attempted to favorite a recipe that cannot be found:', recipeId);
            return;
        }

        const favoriteIndex = this.favorites.findIndex(fav => fav.id === recipeId);
        // Prefer selecting by data attribute on the specific button
        const favoriteBtn = document.querySelector(`.favorite-btn[data-recipe-id="${recipeId}"]`);

        if (favoriteIndex === -1) {
            // Add to favorites
            this.favorites.push(recipe);
            if (favoriteBtn) {
                favoriteBtn.classList.add('favorited');
                favoriteBtn.querySelector('span:last-child').textContent = 'Favorited';
            }

            try {
                await this.saveFavoriteToDatabase(recipe);
            } catch (err) {
                console.error('Failed to save favorite to DB:', err);
                // Even if DB fails, keep local list (we saved to local below)
            }
        } else {
            // Remove from favorites
            this.favorites.splice(favoriteIndex, 1);
            if (favoriteBtn) {
                favoriteBtn.classList.remove('favorited');
                favoriteBtn.querySelector('span:last-child').textContent = 'Save Favorite';
            }

            try {
                await this.removeFavoriteFromDatabase(recipeId);
            } catch (err) {
                console.error('Failed to remove favorite from DB:', err);
            }
        }

        // Persist locally and update UI
        this.saveFavoritesToLocal();
        this.updateFavoritesDisplay();
    }

    // Database Operations for Favorites
    async loadFavoritesFromDatabase() {
        // If DB not available, load from local
        if (!this.isSupabaseConnected || !supabase || !this.userUUID) {
            console.warn('Loading favorites from localStorage fallback');
            this.favorites = this.loadFavoritesFromLocal();
            this.updateFavoritesDisplay();
            return;
        }

        try {
            // Query favorites joining recipes (adjust this query to your schema)
            const { data, error } = await supabase
                .from('favorites')
                .select(`
                    created_at,
                    recipes (
                        id,
                        name,
                        description,
                        ingredients,
                        instructions
                    )
                `)
                .eq('user_id', this.userUUID)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error loading favorites from database:', error);
                this.favorites = this.loadFavoritesFromLocal();
            } else if (Array.isArray(data)) {
                this.favorites = data.map(fav => {
                    const r = fav.recipes || {};
                    return {
                        id: r.id,
                        name: r.name,
                        description: r.description,
                        ingredients: r.ingredients,
                        instructions: r.instructions,
                        favorited_at: fav.created_at
                    };
                });
                console.log('✅ Loaded favorites from database:', this.favorites.length);
            } else {
                console.warn('Unexpected favorites data shape. Falling back to localStorage.');
                this.favorites = this.loadFavoritesFromLocal();
            }
        } catch (error) {
            console.error('Database connection error, using localStorage:', error);
            this.favorites = this.loadFavoritesFromLocal();
        }

        this.updateFavoritesDisplay();
    }

    async saveFavoriteToDatabase(recipe) {
        if (!this.isSupabaseConnected || !supabase || !this.userUUID) {
            console.warn('Saving favorite to localStorage only (no DB connection)');
            this.saveFavoritesToLocal();
            return;
        }

        try {
            // Ensure recipe exists in recipes table: try insert with upsert behavior
            const { error: insertError } = await supabase
                .from('recipes')
                .upsert([{
                    id: recipe.id,
                    name: recipe.name,
                    description: recipe.description,
                    ingredients: recipe.ingredients,
                    instructions: recipe.instructions,
                    source_ingredients: recipe.source_ingredients || 'unknown'
                }], { onConflict: 'id' }); // onConflict depends on your supabase version

            if (insertError) {
                console.warn('Non-fatal error upserting recipe:', insertError);
            }

            // Insert into favorites table
            const { error: favoriteError } = await supabase
                .from('favorites')
                .insert([{
                    user_id: this.userUUID,
                    recipe_id: recipe.id
                }]);

            if (favoriteError) {
                console.error('Error saving favorite:', favoriteError);
                throw favoriteError;
            }

            console.log('✅ Favorite saved to database:', recipe.name);
        } catch (error) {
            console.error('Database save failed, using localStorage fallback:', error);
            this.saveFavoritesToLocal();
            throw error; // rethrow so toggleFavorite can log if needed
        }
    }

    async removeFavoriteFromDatabase(recipeId) {
        if (!this.isSupabaseConnected || !supabase || !this.userUUID) {
            console.warn('Removing favorite from localStorage only (no DB connection)');
            this.saveFavoritesToLocal();
            return;
        }

        try {
            const { error } = await supabase
                .from('favorites')
                .delete()
                .eq('user_id', this.userUUID)
                .eq('recipe_id', recipeId);

            if (error) {
                console.error('Error removing favorite from database:', error);
                throw error;
            }

            console.log('✅ Favorite removed from database:', recipeId);
        } catch (error) {
            console.error('Database removal failed, using localStorage fallback:', error);
            this.saveFavoritesToLocal();
            throw error;
        }
    }

    // Local Storage Fallback Methods
    loadFavoritesFromLocal() {
        try {
            const saved = localStorage.getItem('savorai_favorites');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Error loading favorites from local storage:', error);
            return [];
        }
    }

    saveFavoritesToLocal() {
        try {
            localStorage.setItem('savorai_favorites', JSON.stringify(this.favorites));
        } catch (error) {
            console.error('Error saving favorites to local storage:', error);
        }
    }

    // View Management
    showSearchView() {
        this.currentView = 'search';
        const resultsSection = document.getElementById('results-section');
        const favoritesSection = document.getElementById('favorites-section');
        const backButton = document.getElementById('back-button');

        if (resultsSection) resultsSection.classList.remove('show');
        if (favoritesSection) favoritesSection.classList.remove('show');
        if (backButton) backButton.classList.remove('show');

        const search = document.getElementById('search');
        if (search) search.scrollIntoView({ behavior: 'smooth' });
    }

    showResultsView() {
        this.currentView = 'results';
        const resultsSection = document.getElementById('results-section');
        const favoritesSection = document.getElementById('favorites-section');
        const backButton = document.getElementById('back-button');

        if (resultsSection) resultsSection.classList.add('show');
        if (favoritesSection) favoritesSection.classList.remove('show');
        if (backButton) backButton.classList.add('show');

        if (resultsSection) resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    showFavoritesView() {
        this.currentView = 'favorites';
        const resultsSection = document.getElementById('results-section');
        const favoritesSection = document.getElementById('favorites-section');
        const backButton = document.getElementById('back-button');

        if (resultsSection) resultsSection.classList.remove('show');
        if (favoritesSection) favoritesSection.classList.add('show');
        if (backButton) backButton.classList.remove('show');

        this.updateFavoritesDisplay();

        if (favoritesSection) favoritesSection.scrollIntoView({ behavior: 'smooth' });
    }

    // Update Favorites Display
    updateFavoritesDisplay() {
        const favoritesGrid = document.getElementById('favorites-grid');
        const emptyFavorites = document.getElementById('empty-favorites');

        if (!favoritesGrid || !emptyFavorites) return;

        // Clear existing cards first
        const existingCards = favoritesGrid.querySelectorAll('.recipe-card');
        existingCards.forEach(card => card.remove());

        if (this.favorites.length === 0) {
            emptyFavorites.style.display = 'block';
        } else {
            emptyFavorites.style.display = 'none';

            // Add favorite recipe cards
            this.favorites.forEach(recipe => {
                const card = this.createRecipeCard(recipe);
                // Insert before the empty element (so empty element remains at bottom)
                favoritesGrid.insertBefore(card, emptyFavorites);
            });
        }
    }

    // Back to Search Handler
    handleBackToSearch() {
        // Clear recipes
        this.currentRecipes = [];
        const recipesGrid = document.getElementById('recipes-grid');
        if (recipesGrid) recipesGrid.innerHTML = '';

        // Clear input
        const ingredientsInput = document.getElementById('ingredients-input');
        if (ingredientsInput) ingredientsInput.value = '';

        // Show search view
        this.showSearchView();
    }

    // Loading State Management
    setLoadingState(isLoading) {
        const btn = document.getElementById('find-recipes-btn');
        if (!btn) return;

        const btnText = btn.querySelector('.btn-text') || btn;

        if (isLoading) {
            btn.classList.add('btn-loading');
            btn.disabled = true;
            btnText.textContent = 'Finding Recipes...';
        } else {
            btn.classList.remove('btn-loading');
            btn.disabled = false;
            btnText.textContent = 'Find Recipes';
        }
    }

    // Error Management
    showError(message) {
        const errorElement = document.getElementById('error-message');
        if (!errorElement) {
            console.error('Error element not found:', message);
            return;
        }
        errorElement.innerHTML = `<strong>Oops!</strong> ${this._escapeHTML(message)}`;
        errorElement.classList.add('show');
    }

    hideError() {
        const errorElement = document.getElementById('error-message');
        if (!errorElement) return;
        errorElement.classList.remove('show');
    }

    // TODO: Integrate with Supabase Edge Function
    // This method will be updated to call the actual Supabase Edge Function (kept for reference)
    async callSupabaseEdgeFunction(ingredients) {
        const response = await fetch('https://wcyteslzlckzuuigzqsr.supabase.co/functions/v1/get_recipes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ${SUPABASE_ANON_KEY}'
            },
            body: JSON.stringify({ ingredients })
        });

        if (!response.ok) {
            throw new Error('Failed to fetch recipes from server');
        }

        return await response.json();
    }
}

// Initialize the application when DOM is loaded
let savorAI;
document.addEventListener('DOMContentLoaded', () => {
    savorAI = new SavorAI();

    // Navbar Upgrade button → Show upgrade modal
const upgradeBtn = document.getElementById("upgradeBtn");
if (upgradeBtn) {
    upgradeBtn.addEventListener("click", () => {
        savorAI.showUpgradePrompt();
    });
}

    // Add input focus animations and enter-key behavior
    const ingredientsInput = document.getElementById('ingredients-input');
    if (ingredientsInput) {
        ingredientsInput.addEventListener('focus', () => {
            if (ingredientsInput.parentElement) ingredientsInput.parentElement.style.transform = 'scale(1.02)';
        });

        ingredientsInput.addEventListener('blur', () => {
            if (ingredientsInput.parentElement) ingredientsInput.parentElement.style.transform = 'scale(1)';
        });

        // Enter key support for search: submit the form programmatically
        ingredientsInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const form = document.getElementById('recipe-search-form');
                if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
            }
        });
    }

    // Add header scroll effect
    let lastScrollY = window.scrollY;
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.header');
        if (!header) return;

        const currentScrollY = window.scrollY;

        if (currentScrollY > lastScrollY && currentScrollY > 100) {
            header.style.transform = 'translateY(-100%)';
        } else {
            header.style.transform = 'translateY(0)';
        }

        lastScrollY = currentScrollY;
    });
});
