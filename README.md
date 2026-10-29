# Reel Shelf

Reel Shelf is a free home-screen app for you and your wife. You both sign in and share one shelf of Facebook reels. On iPhone, a free Apple Shortcut adds **Save to Reel Shelf** to Facebook's share menu.

You only do steps 1 and 2. Claude does the rest.

## 1. Create the database (Supabase, free)

1. Go to **supabase.com**, tap **Start your project**, and sign up.
2. Create a **New project**. Name it `reel-shelf`, set a database password (save it somewhere), pick the region closest to you, and stay on the **Free** plan.
3. When the project is ready, open **SQL Editor**, then **New query**. Paste in all of `supabase-setup.sql`, and tap **Run**. It should say "Success. No rows returned".
4. Open **Authentication > Users > Add user > Create new user**. Add yourself with an email and password, and leave **Auto Confirm User** ticked. Then do the same for your wife.
5. Open **Authentication > Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can make an account.
6. Open **Project Settings > API Keys** (or **Settings > API**). Copy the **Project URL** and the **publishable** key (it may be labelled **anon public**), and send both to Claude in the thread. Both are safe to share. **Do not** send the `secret` or `service_role` key.

## 2. Create the website (GitHub Pages, free)

1. Go to **github.com** and sign up.
2. Tap **+ > New repository**. Name it `reel-shelf`, set it to **Public**, and tap **Create repository**.
3. Go to **claude.ai/connect-github** and connect your GitHub account. When GitHub asks which repositories to allow, pick `reel-shelf`.
4. Tell Claude in the thread that it's ready. Claude uploads the app, and then you open **Settings > Pages** in the repository, set **Branch** to `main` and the folder to `/ (root)`, and tap **Save**.

Your app will then be live at `https://YOUR-GITHUB-NAME.github.io/reel-shelf/`.

## 3. On each iPhone

1. Open the app's web address in **Safari** and sign in.
2. Tap **Share > Add to Home Screen**.
3. In the app, open **Settings > Make my Shortcut key** and follow the steps on that screen to build the **Save to Reel Shelf** Shortcut.

Android phones don't need the Shortcut. Once the app is installed, it shows up in the share menu by itself.

## Good to know

- **Cost:** $0. Supabase's free plan and GitHub Pages are both free.
- Supabase pauses free projects that go unused for a week. If the app says it can't load your shelf, sign in at supabase.com and tap **Restore project**. Your reels are kept while it's paused.
- Facebook doesn't let apps read a reel's creator or length. Reels saved from the share menu show **Needs details** until you fill those in from the app.
