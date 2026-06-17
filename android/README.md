# TRUE HR — Employee Self Service (Android)

Native Android app for employees, built with **Kotlin, Jetpack Compose, MVVM + Clean Architecture, Hilt, Retrofit/OkHttp, Coroutines/Flow and DataStore**. It talks to the TRUE HR backend (`/backend`).

## Architecture

```
app/src/main/java/com/truehr/app/
├── core/            Resource<T>, UiState<T>
├── data/
│   ├── local/       TokenStore (DataStore – stores JWT)
│   ├── remote/      ApiService (Retrofit), AuthInterceptor, dto/
│   └── repository/  AuthRepositoryImpl, ProfileRepositoryImpl
├── domain/
│   ├── model/       Profile, SessionUser
│   └── repository/  AuthRepository, ProfileRepository  (interfaces)
├── di/              NetworkModule, RepositoryModule (Hilt)
└── presentation/
    ├── theme/       Color, Type, Theme (GreenHR look)
    ├── components/  reusable Compose UI (buttons, cards, header, loaders)
    ├── navigation/  Routes, AppNavGraph
    ├── splash/  auth/  dashboard/  profile/  feature/   (screens + ViewModels)
```

Layering: **presentation → domain ← data**. ViewModels depend only on domain repository interfaces; Hilt binds the data implementations.

## Features

Wired to the live API:
- **Login** (`POST /auth/login`) with token persisted in DataStore and auto-attached by `AuthInterceptor`.
- **Dashboard** — 12-tile grid (matches the demo).
- **My Profile** & **PF, ESIC & Insurance** (`GET /me/profile`).
- **Change Password** (`POST /auth/change-password`).
- **Attendance → Mark Attendance** — functional Punch In / Punch Out (local for now).
- Splash with session check → routes to Dashboard or Login.

Scaffolded (screens + navigation ready, activate when their API is added):
Daily / Monthly / Team Attendance, Apply/View OD, Miss Punch, Leave, Salary Slip, Team List, Address Book, Policies, Support Desk, Tour, My ESS.

## Run it

1. Open the `android/` folder in **Android Studio** (Koala / Ladybug or newer). It will download the Gradle wrapper and dependencies automatically. (CLI alternative: `gradle wrapper` then `./gradlew assembleDebug`.)
2. Make sure the backend is running (`docker compose up -d` in the repo root).
3. **Base URL** is set in `app/build.gradle.kts`:
   ```
   buildConfigField("String", "BASE_URL", "\"http://10.0.2.2:4000/api/\"")
   ```
   - `10.0.2.2` is how the **Android emulator** reaches your machine's `localhost`.
   - On a **physical device**, change it to your computer's LAN IP, e.g. `http://192.168.1.20:4000/api/`.
   - `usesCleartextTraffic="true"` is enabled for local HTTP testing; remove it for production (HTTPS).
4. Run on an emulator/device. Log in with an **active employee's** official email + the password from their welcome email (or seed one).

## Notes

- Min SDK 24, target/compile SDK 34, Kotlin 2.0, Compose BOM 2024.09.
- The Gradle **wrapper jar** is not committed (binary); Android Studio regenerates it on first open.
- Tokens last 12h; a 401 surfaces as an "invalid credentials / session" message (extend `AuthInterceptor` for auto-refresh/redirect when you add refresh tokens).
