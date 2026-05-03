-- ================================================================
-- NjoroNest — MySQL Schema
-- Run this file once to set up your tables inside the 'school' database
-- In MySQL Workbench or terminal: source schema.sql
-- ================================================================

USE school;

-- ── ROOMS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255)  NOT NULL,
  type        ENUM('bedsitter','single','one-bedroom','shared','airbnb') NOT NULL,
  price       INT           NOT NULL,
  pricing_model ENUM('monthly','nightly','daily') DEFAULT 'monthly',
  min_stay_days INT         DEFAULT 1,
  location    VARCHAR(255)  NOT NULL,
  latitude    DECIMAL(10,7) DEFAULT NULL,
  longitude   DECIMAL(10,7) DEFAULT NULL,
  distance    VARCHAR(100),
  amenities   TEXT,
  description TEXT,
  phone       VARCHAR(20)   NOT NULL,
  badge       ENUM('verified','new') DEFAULT NULL,
  icon        VARCHAR(10)   DEFAULT '🏠',
  photos      TEXT          DEFAULT NULL, -- comma-separated filenames e.g. "photo-123.jpg,photo-456.jpg"
  available   TINYINT(1)    DEFAULT 1,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ── LISTING REQUESTS TABLE ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_requests (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  landlord_name VARCHAR(150) NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  type          VARCHAR(50),
  price         INT,
  location      VARCHAR(255),
  distance      VARCHAR(100),
  amenities     TEXT,
  description   TEXT,
  photos        TEXT         DEFAULT NULL, -- comma-separated filenames
  status        ENUM('pending','approved','rejected') DEFAULT 'pending',
  submitted_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

-- ── BOOKINGS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  room_id        INT          NOT NULL,
  guest_name     VARCHAR(150) NOT NULL,
  guest_phone    VARCHAR(30)  NOT NULL,
  stay_days      INT          NOT NULL,
  check_in_date  DATE         NOT NULL,
  check_out_date DATE         NOT NULL,
  total_price    INT          NOT NULL,
  status         ENUM('booked','cancelled','completed') DEFAULT 'booked',
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- ── SEED DATA — sample rooms to get started ──────────────────────
INSERT INTO rooms (title, type, price, pricing_model, min_stay_days, location, latitude, longitude, distance, amenities, description, phone, badge, icon) VALUES
('Spacious Bedsitter — Self Contained',  'bedsitter',   6000, 'monthly', 1, 'Njoro Town, 8 min walk', NULL, NULL, '8 min walk',  'Water, WiFi, Security, Parking',             'Lovely self-contained bedsitter with constant water supply, WiFi included, and 24hr security. Token electricity. Close to tarmac road.', '0712345678', 'verified', '🏠'),
('Elegant Bedsitter — Near Gate A',      'bedsitter',   4500, 'monthly', 1, 'Njoro, 5 min walk', NULL, NULL, '5 min walk',  'Water, Security, Kitchen',                   'Clean elegant bedsitter, very close to the main university gate. Water available, secure compound.', '0723456789', 'new',      '🏡'),
('Single Room — Budget Friendly',        'single',      3000, 'monthly', 1, 'Njoro, 10 min walk', NULL, NULL, '10 min walk', 'Water, Shared Bathroom',                     'Affordable single room in a shared compound. Good for students on a tight budget.', '0734567890',  NULL,       '🛏️'),
('1 Bedroom Apartment — Modern Finish',  'one-bedroom', 9500, 'monthly', 1, 'Njoro, 12 min walk', NULL, NULL, '12 min walk', 'WiFi, Water, Parking, Kitchen',              'Modern fully finished 1 bedroom. Tiled floor, kitchen cabinets, instant shower, borehole backup water.', '0745678901', 'verified', '🏢'),
('Shared Room — 2 Students',             'shared',      2000, 'monthly', 1, 'Njoro, 6 min walk', NULL, NULL, '6 min walk',  'Water, Security, Budget',                    'Looking for a roommate! Sharing a spacious room in a clean compound. Split costs evenly.', '0756789012', 'new',      '👥'),
('Jirani Guest Suites — Njoro',          'airbnb',      1300, 'nightly', 1, 'Jirani Guest Suites, Njoro', -0.3657200, 35.9339100, '7 min drive', 'WiFi, Parking, Private Bath', 'Based on publicly listed Airbnb-style accommodation in Njoro. Great for short student-family visits.', '0767890123', 'verified', '🏨'),
('Kiamboni 1 Bedroom Stay — Njoro',      'airbnb',      2200, 'nightly', 2, 'Kiamboni area, Njoro', -0.3584500, 35.9201800, '9 min drive', 'WiFi, Kitchen, Parking, Hot Shower', 'Airbnb-style one-bedroom stay suitable for up to 4 guests with flexible short stays.', '0711223344', 'new', '🧳'),
('Black Wattle House — Njoro',           'airbnb',      3200, 'nightly', 2, 'Black Wattle House, Njoro', -0.3526600, 35.9462000, '12 min drive', 'Garden, WiFi, Parking, Quiet Compound', 'Popular Njoro short-stay style house setup for visitors looking for privacy and comfort.', '0722334455', 'verified', '🏘️');