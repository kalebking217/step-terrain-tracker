# 🥾 Step & Terrain Calorie Tracker

An offline-first React Native mobile application built with Expo that tracks steps, calculates real-time calorie burn using the scientific **Pandolf equation**, dynamically adjusts for real-world terrain via OpenStreetMap (Overpass API), and persists session logs locally using SQLite.

---

## ✨ Features

* **Scientific Calorie Calculation:** Implements the **Pandolf et al. (1977)** metabolic equation, taking into account body mass, carried load, walking speed, slope gradient, and terrain difficulty.
* **Real-Time Terrain Detection:** Automatically queries the OpenStreetMap Overpass API based on GPS coordinates to detect surface types (pavement, dirt, grass, sand) with manual override options.
* **Offline-First SQLite Storage:** Automatically saves session metrics (duration, steps, calories, average speed, and terrain) locally so you can view past workouts anytime without an active internet connection.
* **Sensor Integration:** Leverages `expo-sensors` (Pedometer) for step counting and `expo-location` for real-time tracking, altitude changes, and incline calculations.

---

## 🛠️ Tech Stack

* **Framework:** React Native / Expo (SDK 57)
* **Language:** TypeScript
* **Sensors & Location:** `expo-sensors`, `expo-location`
* **Database:** `expo-sqlite` (Local SQLite persistence)
* **APIs:** OpenStreetMap Overpass API (Surface & terrain analysis)

---

## 📂 Project Structure

```text
src/
├── hooks/
│   └── useStepTracker.ts  # Core step tracking, sensor loops, and GPS listeners
├── screens/
│   └── DashboardScreen.tsx # Main UI dashboard and session controls
└── utils/
    └── trackerLib.ts      # Pandolf math engine, OSM fetching, and SQLite DB logic
