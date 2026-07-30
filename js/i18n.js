/* =========================================
   INTERNATIONALIZATION SYSTEM (i18n)
   Supports: English, Russian, Kazakh
   ========================================= */

const translations = {
    en: {
        // Navbar
        nav_home: "Home",
        nav_movies: "Movies",
        nav_mylist: "My List",
        nav_search_placeholder: "Titles...",
        nav_guest: "Guest",
        nav_signin: "Sign In",
        nav_signup: "Create Account",
        nav_settings: "Settings",
        nav_logout: "Logout",
        nav_free_tier: "Free Tier",
        nav_searches: "Searches",
        nav_views: "Views",
        
        // Hero Section
        hero_play: "Play",
        hero_more_info: "More Info",
        hero_loading: "Loading...",
        hero_connecting: "Connecting to Legion Space database...",
        hero_tooltip: "Left click to interact",
        
        // Sections
        section_top_rated: "Top Rated",
        section_grossing: "Top Grossing Blockbusters (%)",
        section_epic_length: "Epic Length Movies",
        section_continue_watching: "Continue Watching",
        section_trending: "Trending Now",
        
        // Promo
        promo_title: "Unlimited Cinema",
        promo_join: "Join us for",
        promo_free: "FREE",
        promo_claim: "Claim Offer",
        promo_limited: "(Launch Offer - Limited Time)",
        
        // Movie Details
        movie_rating: "Rating:",
        movie_released: "Released:",
        movie_runtime: "Runtime:",
        movie_plot: "Plot Overview",
        movie_cast: "Cast",
        movie_watch_on: "Watch Now On",
        movie_description: "Description...",
        
        // About Section
        about_title: "About Legion Space",
        about_text: "Founded in the heart of Astana, Legion Space Cinema is a recently founded startup oriented towards cinematography. Our goal is to make cinema accessible to everyone and to provide safe, affordable and secure streaming/research experiences. We currently host a library of over 10,000 movies, ranging from the era of black and white to modern works of art. Want to witness the magic of accessible and modern experience? Legion Space is your go-to destination for all things film.",
        about_available: "Available On",
        device_phone: "Phone",
        device_tablet: "Tablet",
        device_laptop: "Laptop",
        device_pc: "PC",
        device_tv: "TV",
        
        // Footer
        footer_brand_desc: "A platform for all media lovers, contains all main stream content and more!",
        footer_browse: "Browse",
        footer_home: "Home",
        footer_library: "Movies Library",
        footer_featured: "Featured",
        footer_support: "Support",
        footer_help: "Help Center",
        footer_request: "Request a Movie",
        footer_devices: "Supported Devices",
        footer_contact: "Contact Us",
        footer_account: "Account",
        footer_manage: "Manage Lists",
        footer_subscription: "Subscription",
        footer_gift: "Redeem Gift",
        footer_signout: "Sign Out",
        footer_rights: "© 2026 Legion Space Cinema. All rights reserved.",
        footer_privacy: "Privacy Policy",
        footer_terms: "Terms of Use",
        footer_cookies: "Cookie Preferences",
        
        // Signup Modal
        signup_welcome: "Welcome to Legion Space",
        signup_subtitle: "Create your free account to start watching.",
        signup_username: "Username",
        signup_email: "Email Address",
        signup_password: "Password",
        signup_tier: "Subscription Tier",
        signup_tier_free: "Free (5 Searches / 3 Views)",
        signup_tier_premium: "Premium (50 Searches / 20 Views)",
        signup_tier_gold: "Gold (Unlimited)",
        signup_create: "Create Account",
        signup_or: "OR",
        signup_google: "Continue with Google",
        
        // Settings Modal
        settings_title: "Settings",
        settings_account: "Account Details",
        settings_username: "Username",
        settings_password: "Password",
        settings_profile: "Profile Picture",
        settings_upload: "Upload New Image (1MB)",
        settings_beta: "BETA v0.9",
        settings_beta_text: "You are currently using the Cinematography Preview build of Legion Space.",
        settings_beta_4k: "Experimental 4K Metadata mapping enabled.",
        settings_beta_local: "Localized database: Astana/Kazakhstan Region.",
        settings_beta_readonly: "Some settings are read-only during the hackathon phase.",
        settings_roadmap: "Roadmap & Advanced Features",
        settings_themes: "Custom Themes",
        settings_cloud: "Cloud Sync (Multi-Device)",
        settings_tmdb: "TMDB Global Database",
        settings_coming_soon: "COMING SOON",
        settings_planned: "PLANNED v2.0",
        settings_api_pending: "API PENDING",
        settings_save: "Save Changes",
        settings_theme: "Theme",
        settings_theme_dark: "Dark (Orange-Black)",
        settings_theme_light: "Light Mode",
        settings_language: "Language / Тіл / Язык",
        
        // Redirect Modal
        redirect_title: "Leaving Legion Space?",
        redirect_text: "You are about to be redirected to the official IMDb page for more details on this title.",
        redirect_continue: "Continue to IMDb",
        redirect_cancel: "Cancel",
        
        // Notifications
        notif_signin_success: "Welcome back!",
        notif_signup_success: "Account created successfully!",
        notif_logout: "Logged out successfully",
        notif_settings_saved: "Settings saved",
        notif_error: "An error occurred",
        notif_added_list: "Added to My List",
        notif_removed_list: "Removed from My List",
        
        // All Movies Page
        movies_title: "Complete Movie Library",
        movies_results: "results",
        movies_sort: "Sort By",
        movies_sort_rating: "Rating (High to Low)",
        movies_sort_date_new: "Release Date (Newest)",
        movies_sort_date_old: "Release Date (Oldest)",
        movies_sort_duration: "Duration (Longest)",
        movies_sort_success: "Success Rate (%)",
        movies_filter_year: "Filter by Year",
        movies_filter_genre: "Filter by Genre",
        movies_filter_actor: "Filter by Actor",
        movies_filter_director: "Filter by Director",
        movies_clear_filters: "Clear All Filters",
        movies_loading: "Loading movies...",
        
        // Personal List
        mylist_title: "My Personal Collection",
        mylist_empty: "Your list is empty",
        mylist_signin: "Please sign in to save movies",
        
        // Playlists
        playlist_title: "Community Playlists",
        playlist_create: "Create Playlist",
        playlist_name: "Playlist Name",
        playlist_desc: "Description",
        playlist_movies: "Movies",
        playlist_delete: "Delete Playlist",
        playlist_add_movie: "Add to Playlist",
        playlist_remove_movie: "Remove from Playlist",
        playlist_vote_up: "Upvote",
        playlist_vote_down: "Downvote",
        playlist_comment: "Comment",
        playlist_comments: "Comments",
        playlist_no_comments: "No comments yet",
        playlist_signin_required: "Sign in to interact"
    },
    
    ru: {
        // Navbar
        nav_home: "Главная",
        nav_movies: "Фильмы",
        nav_mylist: "Мой список",
        nav_search_placeholder: "Названия...",
        nav_guest: "Гость",
        nav_signin: "Войти",
        nav_signup: "Создать аккаунт",
        nav_settings: "Настройки",
        nav_logout: "Выйти",
        nav_free_tier: "Бесплатный тариф",
        nav_searches: "Поиски",
        nav_views: "Просмотры",
        
        // Hero Section
        hero_play: "Смотреть",
        hero_more_info: "Подробнее",
        hero_loading: "Загрузка...",
        hero_connecting: "Подключение к базе данных Legion Space...",
        hero_tooltip: "Нажмите для взаимодействия",
        
        // Sections
        section_top_rated: "Лучшие по рейтингу",
        section_grossing: "Самые кассовые блокбастеры (%)",
        section_epic_length: "Эпические длинные фильмы",
        section_continue_watching: "Продолжить просмотр",
        section_trending: "В тренде сейчас",
        
        // Promo
        promo_title: "Безлимитный кинотеатр",
        promo_join: "Присоединяйтесь за",
        promo_free: "БЕСПЛАТНО",
        promo_claim: "Получить предложение",
        promo_limited: "(Стартовое предложение - Ограниченное время)",
        
        // Movie Details
        movie_rating: "Рейтинг:",
        movie_released: "Выпущен:",
        movie_runtime: "Длительность:",
        movie_plot: "Описание сюжета",
        movie_cast: "Актёры",
        movie_watch_on: "Смотреть на",
        movie_description: "Описание...",
        
        // About Section
        about_title: "О Legion Space",
        about_text: "Основанный в самом сердце Астаны, Legion Space Cinema — это недавно созданный стартап, ориентированный на кинематографию. Наша цель — сделать кино доступным для всех и обеспечить безопасный, доступный и надёжный опыт потоковой передачи и исследования. В настоящее время мы располагаем библиотекой из более чем 10 000 фильмов, от эпохи чёрно-белого кино до современных произведений искусства. Хотите стать свидетелем магии доступного и современного опыта? Legion Space — ваше место для всего, что связано с кино.",
        about_available: "Доступно на",
        device_phone: "Телефон",
        device_tablet: "Планшет",
        device_laptop: "Ноутбук",
        device_pc: "ПК",
        device_tv: "ТВ",
        
        // Footer
        footer_brand_desc: "Премиальное место для любителей кино в Астане. От казахских шедевров до мировых блокбастеров — мы транслируем всё это.",
        footer_browse: "Обзор",
        footer_home: "Главная",
        footer_library: "Библиотека фильмов",
        footer_featured: "Избранное",
        footer_support: "Поддержка",
        footer_help: "Центр помощи",
        footer_request: "Запросить фильм",
        footer_devices: "Поддерживаемые устройства",
        footer_contact: "Связаться с нами",
        footer_account: "Аккаунт",
        footer_manage: "Управление списками",
        footer_subscription: "Подписка",
        footer_gift: "Использовать подарок",
        footer_signout: "Выйти",
        footer_rights: "© 2026 Legion Space Cinema. Все права защищены.",
        footer_privacy: "Политика конфиденциальности",
        footer_terms: "Условия использования",
        footer_cookies: "Настройки файлов cookie",
        
        // Signup Modal
        signup_welcome: "Добро пожаловать в Legion Space",
        signup_subtitle: "Создайте бесплатный аккаунт, чтобы начать просмотр.",
        signup_username: "Имя пользователя",
        signup_email: "Адрес электронной почты",
        signup_password: "Пароль",
        signup_tier: "Уровень подписки",
        signup_tier_free: "Бесплатный (5 поисков / 3 просмотра)",
        signup_tier_premium: "Премиум (50 поисков / 20 просмотров)",
        signup_tier_gold: "Золотой (Безлимит)",
        signup_create: "Создать аккаунт",
        signup_or: "ИЛИ",
        signup_google: "Продолжить с Google",
        
        // Settings Modal
        settings_title: "Настройки",
        settings_account: "Данные аккаунта",
        settings_username: "Имя пользователя",
        settings_password: "Пароль",
        settings_profile: "Изображение профиля",
        settings_upload: "Загрузить новое изображение (1МБ)",
        settings_beta: "БЕТА v0.9",
        settings_beta_text: "Вы используете превью-версию Cinematography от Legion Space.",
        settings_beta_4k: "Экспериментальное сопоставление метаданных 4K включено.",
        settings_beta_local: "Локализованная база данных: регион Астана/Казахстан.",
        settings_beta_readonly: "Некоторые настройки доступны только для чтения во время фазы хакатона.",
        settings_roadmap: "План развития и расширенные функции",
        settings_themes: "Пользовательские темы",
        settings_cloud: "Облачная синхронизация (Мульти-устройство)",
        settings_tmdb: "Глобальная база данных TMDB",
        settings_coming_soon: "СКОРО",
        settings_planned: "ПЛАНИРУЕТСЯ v2.0",
        settings_api_pending: "API В ОЖИДАНИИ",
        settings_save: "Сохранить изменения",
        settings_theme: "Тема",
        settings_theme_dark: "Тёмная (Оранжево-чёрная)",
        settings_theme_light: "Светлая",
        settings_language: "Language / Тіл / Язык",
        
        // Redirect Modal
        redirect_title: "Покидаете Legion Space?",
        redirect_text: "Вы будете перенаправлены на официальную страницу IMDb для получения дополнительной информации об этом фильме.",
        redirect_continue: "Перейти на IMDb",
        redirect_cancel: "Отмена",
        
        // Notifications
        notif_signin_success: "С возвращением!",
        notif_signup_success: "Аккаунт успешно создан!",
        notif_logout: "Вы успешно вышли из системы",
        notif_settings_saved: "Настройки сохранены",
        notif_error: "Произошла ошибка",
        notif_added_list: "Добавлено в мой список",
        notif_removed_list: "Удалено из моего списка",
        
        // All Movies Page
        movies_title: "Полная библиотека фильмов",
        movies_results: "результатов",
        movies_sort: "Сортировать по",
        movies_sort_rating: "Рейтинг (от высокого к низкому)",
        movies_sort_date_new: "Дата выхода (Новые)",
        movies_sort_date_old: "Дата выхода (Старые)",
        movies_sort_duration: "Длительность (Самые длинные)",
        movies_sort_success: "Уровень успеха (%)",
        movies_filter_year: "Фильтр по году",
        movies_filter_genre: "Фильтр по жанру",
        movies_filter_actor: "Фильтр по актёру",
        movies_filter_director: "Фильтр по режиссёру",
        movies_clear_filters: "Очистить все фильтры",
        movies_loading: "Загрузка фильмов...",
        
        // Personal List
        mylist_title: "Моя личная коллекция",
        mylist_empty: "Ваш список пуст",
        mylist_signin: "Пожалуйста, войдите, чтобы сохранять фильмы",
        
        // Playlists
        playlist_title: "Плейлисты сообщества",
        playlist_create: "Создать плейлист",
        playlist_name: "Название плейлиста",
        playlist_desc: "Описание",
        playlist_movies: "Фильмы",
        playlist_delete: "Удалить плейлист",
        playlist_add_movie: "Добавить в плейлист",
        playlist_remove_movie: "Удалить из плейлиста",
        playlist_vote_up: "Голосовать за",
        playlist_vote_down: "Голосовать против",
        playlist_comment: "Комментарий",
        playlist_comments: "Комментарии",
        playlist_no_comments: "Пока нет комментариев",
        playlist_signin_required: "Войдите для взаимодействия"
    },
    
    kz: {
        // Navbar
        nav_home: "Басты бет",
        nav_movies: "Фильмдер",
        nav_mylist: "Менің тізімім",
        nav_search_placeholder: "Атауы...",
        nav_guest: "Қонақ",
        nav_signin: "Кіру",
        nav_signup: "Тіркелгі жасау",
        nav_settings: "Параметрлер",
        nav_logout: "Шығу",
        nav_free_tier: "Тегін тариф",
        nav_searches: "Іздеулер",
        nav_views: "Қараулар",
        
        // Hero Section
        hero_play: "Қарау",
        hero_more_info: "Толығырақ",
        hero_loading: "Жүктелуде...",
        hero_connecting: "Legion Space дерекқорына қосылу...",
        hero_tooltip: "Өзара әрекет үшін басыңыз",
        
        // Sections
        section_top_rated: "Ең жоғары рейтингтілер",
        section_grossing: "Ең кассалық блокбастерлер (%)",
        section_epic_length: "Эпикалық ұзын фильмдер",
        section_continue_watching: "Қарауды жалғастыру",
        section_trending: "Қазір тренд",
        
        // Promo
        promo_title: "Шексіз кинотеатр",
        promo_join: "Бізге қосылыңыз",
        promo_free: "ТЕГІН",
        promo_claim: "Ұсынысты алу",
        promo_limited: "(Іске қосу ұсынысы - Шектеулі уақыт)",
        
        // Movie Details
        movie_rating: "Рейтинг:",
        movie_released: "Шығарылды:",
        movie_runtime: "Ұзақтығы:",
        movie_plot: "Сюжет шолуы",
        movie_cast: "Актерлер",
        movie_watch_on: "Қарау орны",
        movie_description: "Сипаттама...",
        
        // About Section
        about_title: "Legion Space туралы",
        about_text: "Астананың жүрегінде құрылған Legion Space Cinema — кинематографияға бағытталған жақында құрылған стартап. Біздің мақсатымыз кинематографты барлығына қолжетімді ету және қауіпсіз, қолжетімді және сенімді трансляция/зерттеу тәжірибесін қамтамасыз ету. Біз қазір 10,000-нан астам фильмді, ақ-қара дәуірінен бастап қазіргі заманғы өнер туындыларына дейін ұсынамыз. Қолжетімді және заманауи тәжірибенің сиқырына куә болғыңыз келе ме? Legion Space — сіздің кино туралы барлық нәрсеге арналған орныңыз.",
        about_available: "Қолжетімді",
        device_phone: "Телефон",
        device_tablet: "Планшет",
        device_laptop: "Ноутбук",
        device_pc: "ПК",
        device_tv: "ТД",
        
        // Footer
        footer_brand_desc: "Астанадағы кино әуесқойларына арналған премиум орын. Қазақ шедеврлерінен әлемдік блокбастерлерге дейін — біз барлығын трансляциялаймыз.",
        footer_browse: "Шолу",
        footer_home: "Басты бет",
        footer_library: "Фильмдер кітапханасы",
        footer_featured: "Таңдаулы",
        footer_support: "Қолдау",
        footer_help: "Анықтама орталығы",
        footer_request: "Фильм сұрау",
        footer_devices: "Қолдау көрсетілетін құрылғылар",
        footer_contact: "Бізбен байланысу",
        footer_account: "Тіркелгі",
        footer_manage: "Тізімдерді басқару",
        footer_subscription: "Жазылым",
        footer_gift: "Сыйлықты пайдалану",
        footer_signout: "Шығу",
        footer_rights: "© 2026 Legion Space Cinema. Барлық құқықтар қорғалған.",
        footer_privacy: "Құпиялылық саясаты",
        footer_terms: "Пайдалану шарттары",
        footer_cookies: "Cookie параметрлері",
        
        // Signup Modal
        signup_welcome: "Legion Space-ке қош келдіңіз",
        signup_subtitle: "Қарауды бастау үшін тегін тіркелгі жасаңыз.",
        signup_username: "Пайдаланушы аты",
        signup_email: "Электрондық пошта мекенжайы",
        signup_password: "Құпия сөз",
        signup_tier: "Жазылым деңгейі",
        signup_tier_free: "Тегін (5 іздеу / 3 қарау)",
        signup_tier_premium: "Премиум (50 іздеу / 20 қарау)",
        signup_tier_gold: "Алтын (Шектеусіз)",
        signup_create: "Тіркелгі жасау",
        signup_or: "НЕМЕСЕ",
        signup_google: "Google арқылы жалғастыру",
        
        // Settings Modal
        settings_title: "Параметрлер",
        settings_account: "Тіркелгі мәліметтері",
        settings_username: "Пайдаланушы аты",
        settings_password: "Құпия сөз",
        settings_profile: "Профиль суреті",
        settings_upload: "Жаңа сурет жүктеу (1МБ)",
        settings_beta: "БЕТА v0.9",
        settings_beta_text: "Сіз Legion Space Cinematography Preview нұсқасын пайдаланып жатырсыз.",
        settings_beta_4k: "Эксперименттік 4K метадеректерді сәйкестендіру қосылған.",
        settings_beta_local: "Жергілікті дерекқор: Астана/Қазақстан аймағы.",
        settings_beta_readonly: "Хакатон кезеңінде кейбір параметрлер тек оқуға арналған.",
        settings_roadmap: "Даму жоспары және кеңейтілген мүмкіндіктер",
        settings_themes: "Пайдаланушы тақырыптары",
        settings_cloud: "Бұлтты синхрондау (Көп құрылғы)",
        settings_tmdb: "TMDB жаһандық дерекқоры",
        settings_coming_soon: "ЖАҚЫНДА",
        settings_planned: "ЖОСПАРЛАНҒАН v2.0",
        settings_api_pending: "API КҮТУДЕ",
        settings_save: "Өзгерістерді сақтау",
        settings_theme: "Тақырып",
        settings_theme_dark: "Қараңғы (Қызғылт сары-қара)",
        settings_theme_light: "Ашық режим",
        settings_language: "Language / Тіл / Язык",
        
        // Redirect Modal
        redirect_title: "Legion Space-тен шығасыз ба?",
        redirect_text: "Сіз осы фильм туралы қосымша ақпарат алу үшін IMDb ресми бетіне бағытталасыз.",
        redirect_continue: "IMDb-ге өту",
        redirect_cancel: "Болдырмау",
        
        // Notifications
        notif_signin_success: "Қайта оралуыңызбен!",
        notif_signup_success: "Тіркелгі сәтті жасалды!",
        notif_logout: "Сіз сәтті шықтыңыз",
        notif_settings_saved: "Параметрлер сақталды",
        notif_error: "Қате пайда болды",
        notif_added_list: "Менің тізіміме қосылды",
        notif_removed_list: "Менің тізімімнен жойылды",
        
        // All Movies Page
        movies_title: "Толық фильмдер кітапханасы",
        movies_results: "нәтижелер",
        movies_sort: "Сұрыптау",
        movies_sort_rating: "Рейтинг (жоғарыдан төменге)",
        movies_sort_date_new: "Шығарылу күні (Жаңалар)",
        movies_sort_date_old: "Шығарылу күні (Ескілер)",
        movies_sort_duration: "Ұзақтығы (Ең ұзын)",
        movies_sort_success: "Табыс деңгейі (%)",
        movies_filter_year: "Жыл бойынша сүзу",
        movies_filter_genre: "Жанр бойынша сүзу",
        movies_filter_actor: "Актер бойынша сүзу",
        movies_filter_director: "Режиссер бойынша сүзу",
        movies_clear_filters: "Барлық сүзгілерді тазалау",
        movies_loading: "Фильмдер жүктелуде...",
        
        // Personal List
        mylist_title: "Менің жеке жинағым",
        mylist_empty: "Сіздің тізіміңіз бос",
        mylist_signin: "Фильмдерді сақтау үшін кіріңіз",
        
        // Playlists
        playlist_title: "Қоғамдастық ойнату тізімдері",
        playlist_create: "Ойнату тізімін жасау",
        playlist_name: "Ойнату тізімінің атауы",
        playlist_desc: "Сипаттама",
        playlist_movies: "Фильмдер",
        playlist_delete: "Ойнату тізімін жою",
        playlist_add_movie: "Ойнату тізіміне қосу",
        playlist_remove_movie: "Ойнату тізімінен жою",
        playlist_vote_up: "Дауыс беру",
        playlist_vote_down: "Дауыс беру қарсы",
        playlist_comment: "Түсініктеме",
        playlist_comments: "Түсініктемелер",
        playlist_no_comments: "Әзірге түсініктемелер жоқ",
        playlist_signin_required: "Өзара әрекет үшін кіріңіз"
    }
};

// Current language state
let currentLanguage = localStorage.getItem('userLanguage') || 'en';

// Get translation
function t(key) {
    return translations[currentLanguage][key] || translations['en'][key] || key;
}

// Change language
function changeLanguage(lang) {
    if (!translations[lang]) {
        console.warn(`Language "${lang}" not supported, defaulting to English`);
        lang = 'en';
    }
    
    currentLanguage = lang;
    localStorage.setItem('userLanguage', lang);
    
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

// Update all translations on the page
function updateTranslations() {
    // no-op
}

// Initialize i18n on page load
document.addEventListener('DOMContentLoaded', () => {
    // no-op
});

// Export for use in other scripts
window.i18n = {
    t,
    changeLanguage,
    getCurrentLanguage: () => currentLanguage,
    updateTranslations
};
