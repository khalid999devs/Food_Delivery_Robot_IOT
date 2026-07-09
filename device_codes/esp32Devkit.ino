#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>

// ================= WIFI CONFIG =================
const char* WIFI_SSID = "Khalid's IPHN";
const char* WIFI_PASSWORD = "khalid0123";

// ================= MQTT CONFIG =================
const char* MQTT_HOST = "20d87d0e061f44e78146cb2e7f0a4a2b.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;

const char* MQTT_USERNAME = "robot_user";
const char* MQTT_PASSWORD = "RobotUser1234";

// ================= DEVICE CONFIG =================
const char* DEVICE_ID = "robot_car_001";

String commandTopic = "devices/" + String(DEVICE_ID) + "/command";
String statusTopic = "devices/" + String(DEVICE_ID) + "/status";
String eventTopic = "devices/" + String(DEVICE_ID) + "/event";
String telemetryTopic = "devices/" + String(DEVICE_ID) + "/telemetry";

// ================= SERIAL LINKS =================
HardwareSerial CamSerial(1);
HardwareSerial ArduinoSerial(2);

const int CAM_RX_PIN = 21;
const int CAM_TX_PIN = 22;

const int ARDUINO_RX_PIN = 26;
const int ARDUINO_TX_PIN = 27;

// ================= GPS =================
const int GPS_RX_PIN = 16;
const int GPS_TX_PIN = 17;

SoftwareSerial GPSSerial;
TinyGPSPlus gps;

// ================= HC-SR04 ULTRASONIC =================
const int ULTRASONIC_TRIG_PIN = 25;
const int ULTRASONIC_ECHO_PIN = 33;

float lastDistanceCm = -1;

const float OBSTACLE_STOP_DISTANCE_CM = 8.0;
const float OBSTACLE_CLEAR_DISTANCE_CM = 12.0;

const unsigned long ULTRASONIC_INTERVAL_MS = 120;
const unsigned long ULTRASONIC_TIMEOUT_US = 15000;

unsigned long lastUltrasonicReadTime = 0;
bool obstacleStopActive = false;

// ================= CART IR PRODUCT SENSORS =================
const int CART_IR1_PIN = 32;
const int CART_IR2_PIN = 35;

int lastCartIr1State = HIGH;
int lastCartIr2State = HIGH;

unsigned long lastCartIr1TriggerTime = 0;
unsigned long lastCartIr2TriggerTime = 0;
unsigned long lastProductTriggerTime = 0;

const unsigned long CART_IR_DEBOUNCE_MS = 250;
const unsigned long PRODUCT_COUNT_COOLDOWN_MS = 700;

int cartIr1Count = 0;
int cartIr2Count = 0;
int cartProductCount = 0;
int expectedProductCount = 0;

bool productDetectionArmed = false;

// ================= MQTT CLIENT =================
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

String lastCommandId = "";
String lastStatusJson = "";

// ================= LOCAL STATE =================
String camLine = "";
String arduinoLine = "";
String usbLine = "";

bool arduinoReady = false;
bool autoStarted = false;
bool autoCancelled = false;
bool autoFinished = false;

bool manualMode = false;
bool deliveryAllowed = false;
bool returnHomeActive = false;

int autoTargetStation = 3;

int orderProductA = 0;
int orderProductB = 0;

bool userLocationAvailable = false;
double userLatitude = 0.0;
double userLongitude = 0.0;
float userLocationAccuracy = 0.0;
String userLocationCapturedAt = "";

String currentOrderId = "";
String currentTargetStation = "";
String robotMode = "idle";
String activeDeliveryCommandId = "";
String activeReturnCommandId = "";

unsigned long arduinoReadyTime = 0;
unsigned long lastStatusRequestTime = 0;
unsigned long lastMqttReconnectAttempt = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastGpsPrintTime = 0;

const unsigned long HEARTBEAT_INTERVAL_MS = 5000;

// ================= TELEMETRY =================
bool telemetryActive = false;

unsigned long telemetryStartedAt = 0;
unsigned long telemetryDurationMs = 600000;
unsigned long telemetryIntervalMs = 1000;
unsigned long lastTelemetryTime = 0;

// ================= BASIC HELPERS =================
String getParamString(JsonVariant params, const char* key, const String& fallback) {
  if (params.isNull()) return fallback;
  if (params[key].isNull()) return fallback;

  if (params[key].is<const char*>()) {
    return String(params[key].as<const char*>());
  }

  return String(params[key].as<String>());
}

int getParamInt(JsonVariant params, const char* key, int fallback) {
  if (params.isNull()) return fallback;
  if (params[key].isNull()) return fallback;

  return params[key].as<int>();
}

unsigned long getParamULong(JsonVariant params, const char* key, unsigned long fallback) {
  if (params.isNull()) return fallback;
  if (params[key].isNull()) return fallback;

  return params[key].as<unsigned long>();
}

int stationStringToNumber(String station) {
  station.trim();

  if (station == "station_1" || station == "1") return 1;
  if (station == "station_2" || station == "2") return 2;
  if (station == "station_3" || station == "3") return 3;
  if (station == "station_4" || station == "4") return 4;

  return 3;
}

bool isValidStation(String station) {
  return station == "station_1" ||
         station == "station_2" ||
         station == "station_3" ||
         station == "station_4" ||
         station == "1" ||
         station == "2" ||
         station == "3" ||
         station == "4";
}

bool isAllowedCommand(String command) {
  return command == "ping" ||
         command == "status" ||
         command == "manual_on" ||
         command == "manual_off" ||
         command == "forward" ||
         command == "backward" ||
         command == "left" ||
         command == "right" ||
         command == "stop" ||
         command == "prepare_for_pickup" ||
         command == "start_delivery" ||
         command == "simulate_order_completed" ||
         command == "go_to_station" ||
         command == "cancel_delivery" ||
         command == "go_to_vending" ||
         command == "delivery_loaded" ||
         command == "delivery_received" ||
         command == "return_home" ||
         command == "line_follow_on" ||
         command == "line_follow_off" ||
         command == "start_telemetry" ||
         command == "stop_telemetry";
}

void resetUserLocation() {
  userLocationAvailable = false;
  userLatitude = 0.0;
  userLongitude = 0.0;
  userLocationAccuracy = 0.0;
  userLocationCapturedAt = "";
}

void updateUserLocationFromParams(JsonVariant params) {
  if (params.isNull()) return;

  JsonVariant loc = params["userLocation"];
  if (loc.isNull()) return;

  if (!loc["latitude"].isNull() && !loc["longitude"].isNull()) {
    userLatitude = loc["latitude"].as<double>();
    userLongitude = loc["longitude"].as<double>();
    userLocationAvailable = true;
  }

  if (!loc["accuracy"].isNull()) {
    userLocationAccuracy = loc["accuracy"].as<float>();
  }

  if (!loc["capturedAt"].isNull()) {
    userLocationCapturedAt = String(loc["capturedAt"].as<const char*>());
  }
}

bool isCurrentOrderLoaded() {
  return expectedProductCount > 0 && cartProductCount >= expectedProductCount;
}

bool isSameOrderOrNoOrder(const String& incomingOrderId) {
  if (currentOrderId.length() == 0) return true;
  if (incomingOrderId.length() == 0) return true;
  return incomingOrderId == currentOrderId;
}

// ================= JSON SENSOR HELPERS =================
template <typename T>
void addGpsToJson(T& doc) {
  JsonObject gpsObj = doc.createNestedObject("gps");

  gpsObj["valid"] = gps.location.isValid();
  gpsObj["satellites"] = gps.satellites.isValid() ? gps.satellites.value() : 0;
  gpsObj["ageMs"] = gps.location.age();

  if (gps.location.isValid()) {
    gpsObj["lat"] = gps.location.lat();
    gpsObj["lng"] = gps.location.lng();
  } else {
    gpsObj["lat"] = nullptr;
    gpsObj["lng"] = nullptr;
  }
}

template <typename T>
void addCartIrToJson(T& doc) {
  JsonObject cartObj = doc.createNestedObject("cart");

  cartObj["ir1State"] = digitalRead(CART_IR1_PIN);
  cartObj["ir2State"] = digitalRead(CART_IR2_PIN);
  cartObj["ir1Count"] = cartIr1Count;
  cartObj["ir2Count"] = cartIr2Count;
  cartObj["productCount"] = cartProductCount;
  cartObj["expectedProductCount"] = expectedProductCount;
  cartObj["productDetectionArmed"] = productDetectionArmed;
}

template <typename T>
void addUltrasonicToJson(T& doc) {
  JsonObject ultrasonicObj = doc.createNestedObject("ultrasonic");

  ultrasonicObj["distanceCm"] = lastDistanceCm;
  ultrasonicObj["obstacleStopActive"] = obstacleStopActive;
  ultrasonicObj["stopThresholdCm"] = OBSTACLE_STOP_DISTANCE_CM;
  ultrasonicObj["clearThresholdCm"] = OBSTACLE_CLEAR_DISTANCE_CM;
}

template <typename T>
void addOrderDetailsToJson(T& doc) {
  JsonObject orderObj = doc.createNestedObject("order");

  orderObj["orderId"] = currentOrderId;
  orderObj["targetStation"] = currentTargetStation;
  orderObj["a"] = orderProductA;
  orderObj["b"] = orderProductB;
  orderObj["expectedProducts"] = expectedProductCount;
  orderObj["cartProductCount"] = cartProductCount;
  orderObj["productLoaded"] = isCurrentOrderLoaded();

  JsonObject userLocObj = orderObj.createNestedObject("userLocation");
  userLocObj["available"] = userLocationAvailable;

  if (userLocationAvailable) {
    userLocObj["latitude"] = userLatitude;
    userLocObj["longitude"] = userLongitude;
    userLocObj["accuracy"] = userLocationAccuracy;
    userLocObj["capturedAt"] = userLocationCapturedAt;
  } else {
    userLocObj["latitude"] = nullptr;
    userLocObj["longitude"] = nullptr;
    userLocObj["accuracy"] = nullptr;
    userLocObj["capturedAt"] = nullptr;
  }
}

// ================= MQTT PUBLISH HELPERS =================
void publishRawStatus(const String& json) {
  mqttClient.publish(statusTopic.c_str(), json.c_str(), false);
}

void publishStatus(
  const String& commandId,
  const String& status,
  const String& message,
  const String& command,
  const String& arduinoReply
) {
  StaticJsonDocument<2048> doc;

  doc["commandId"] = commandId;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["message"] = message;
  doc["command"] = command;
  doc["arduinoReply"] = arduinoReply;

  doc["orderId"] = currentOrderId;
  doc["targetStation"] = currentTargetStation;
  doc["robotMode"] = robotMode;
  doc["manualMode"] = manualMode;

  doc["arduinoReady"] = arduinoReady;
  doc["autoStarted"] = autoStarted;
  doc["autoCancelled"] = autoCancelled;
  doc["autoFinished"] = autoFinished;
  doc["deliveryAllowed"] = deliveryAllowed;
  doc["returnHomeActive"] = returnHomeActive;
  doc["autoTargetStation"] = autoTargetStation;

  doc["uptimeMs"] = millis();

  addCartIrToJson(doc);
  addUltrasonicToJson(doc);
  addOrderDetailsToJson(doc);

  char buffer[2048];
  serializeJson(doc, buffer);

  lastStatusJson = String(buffer);

  mqttClient.publish(statusTopic.c_str(), buffer, false);

  Serial.println("Status published:");
  Serial.println(buffer);
}

void publishEvent(
  const String& eventName,
  const String& message
) {
  StaticJsonDocument<2048> doc;

  doc["deviceId"] = DEVICE_ID;
  doc["event"] = eventName;
  doc["message"] = message;

  doc["orderId"] = currentOrderId;
  doc["targetStation"] = currentTargetStation;
  doc["robotMode"] = robotMode;
  doc["manualMode"] = manualMode;
  doc["returnHomeActive"] = returnHomeActive;
  doc["uptimeMs"] = millis();

  addCartIrToJson(doc);
  addUltrasonicToJson(doc);
  addOrderDetailsToJson(doc);

  char buffer[2048];
  serializeJson(doc, buffer);

  mqttClient.publish(eventTopic.c_str(), buffer, false);

  Serial.println("Event published:");
  Serial.println(buffer);
}

void publishTelemetry() {
  StaticJsonDocument<3072> doc;

  doc["deviceId"] = DEVICE_ID;
  doc["orderId"] = currentOrderId;
  doc["targetStation"] = currentTargetStation;
  doc["robotMode"] = robotMode;
  doc["manualMode"] = manualMode;

  doc["arduinoReady"] = arduinoReady;
  doc["autoStarted"] = autoStarted;
  doc["autoCancelled"] = autoCancelled;
  doc["autoFinished"] = autoFinished;
  doc["deliveryAllowed"] = deliveryAllowed;
  doc["returnHomeActive"] = returnHomeActive;
  doc["autoTargetStation"] = autoTargetStation;

  doc["telemetryActive"] = telemetryActive;
  doc["uptimeMs"] = millis();

  addGpsToJson(doc);
  addCartIrToJson(doc);
  addUltrasonicToJson(doc);
  addOrderDetailsToJson(doc);

  char buffer[3072];
  serializeJson(doc, buffer);

  mqttClient.publish(telemetryTopic.c_str(), buffer, false);

  Serial.println("Telemetry published:");
  Serial.println(buffer);
}

void publishOnlineStatus() {
  publishStatus(
    "",
    "online",
    "Robot ESP32 DevKit connected",
    "",
    "ESP32_READY"
  );
}

// ================= SERIAL SEND HELPERS =================
void sendToArduino(const String &message) {
  ArduinoSerial.println(message);

  Serial.print("ESP32 -> Arduino: ");
  Serial.println(message);
}

void sendToCam(const String &message) {
  CamSerial.println(message);

  Serial.print("ESP32 -> CAM: ");
  Serial.println(message);
}

// ================= ARDUINO READY / AUTO FLOW =================
void markArduinoReady() {
  if (!arduinoReady) {
    arduinoReady = true;
    arduinoReadyTime = millis();

    Serial.println();
    Serial.println("Arduino is ready.");
    Serial.println();

    publishEvent("arduino_ready", "Arduino lower layer is ready");
  }
}

void cancelAutoForManual() {
  if (!autoCancelled) {
    autoCancelled = true;
    autoStarted = false;
    deliveryAllowed = false;
    returnHomeActive = false;
    robotMode = "manual_override";

    sendToArduino("CMD,S");

    Serial.println();
    Serial.println("AUTO LINE MODE CANCELLED BY MANUAL CONTROL");
    Serial.println();

    publishEvent("manual_override", "Auto/return mode cancelled by manual control");
  }
}

void startAutoStationRun(int stationNumber) {
  if (obstacleStopActive) {
    robotMode = "obstacle_stop";

    sendToArduino("CMD,S");

    publishStatus(
      activeDeliveryCommandId,
      "blocked",
      "Cannot start delivery because obstacle is under 8 cm",
      "start_delivery",
      "OBSTACLE_ACTIVE"
    );

    publishEvent("obstacle_blocked_delivery", "Delivery start blocked because obstacle is under 8 cm");

    return;
  }

  autoTargetStation = stationNumber;
  autoStarted = true;
  autoCancelled = false;
  autoFinished = false;
  returnHomeActive = false;

  robotMode = "line_delivery_running";

  String command = "LINE,";
  command += autoTargetStation;

  sendToArduino(command);

  Serial.println();
  Serial.print("AUTO LINE MODE STARTED. Target station: ");
  Serial.println(autoTargetStation);
  Serial.println();

  publishStatus(
    activeDeliveryCommandId,
    "delivery_started",
    "Robot started line-following delivery",
    "start_delivery",
    command
  );

  publishEvent("delivery_started", "Robot started delivery to target station");
}

void handleAutoStart() {
  if (!deliveryAllowed) {
    return;
  }

  if (obstacleStopActive) {
    deliveryAllowed = false;
    autoStarted = false;
    autoCancelled = true;

    sendToArduino("CMD,S");

    publishStatus(
      activeDeliveryCommandId,
      "blocked",
      "Delivery blocked because obstacle is under 8 cm",
      "start_delivery",
      "OBSTACLE_ACTIVE"
    );

    publishEvent("obstacle_blocked_delivery", "Delivery blocked before auto start");

    return;
  }

  if (!arduinoReady) {
    if (millis() - lastStatusRequestTime >= 2000) {
      lastStatusRequestTime = millis();
      sendToArduino("STATUS?");
    }

    return;
  }

  if (autoStarted || autoCancelled || autoFinished) {
    return;
  }

  if (millis() - arduinoReadyTime >= 500) {
    startAutoStationRun(autoTargetStation);
  }
}

// ================= ULTRASONIC SAFETY =================
float readUltrasonicDistanceCm() {
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(ULTRASONIC_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ULTRASONIC_ECHO_PIN, HIGH, ULTRASONIC_TIMEOUT_US);

  if (duration == 0) {
    return -1;
  }

  return (duration * 0.0343) / 2.0;
}

void handleUltrasonicSafety() {
  unsigned long now = millis();

  if (now - lastUltrasonicReadTime < ULTRASONIC_INTERVAL_MS) {
    return;
  }

  lastUltrasonicReadTime = now;

  float distance = readUltrasonicDistanceCm();

  if (distance > 0) {
    lastDistanceCm = distance;
  }

  if (lastDistanceCm > 0 && lastDistanceCm < OBSTACLE_STOP_DISTANCE_CM && !obstacleStopActive) {
    obstacleStopActive = true;

    autoStarted = false;
    deliveryAllowed = false;
    autoCancelled = true;
    returnHomeActive = false;
    robotMode = "obstacle_stop";

    sendToArduino("CMD,S");

    Serial.println();
    Serial.println("OBSTACLE DETECTED UNDER 8 CM. EMERGENCY STOP SENT.");
    Serial.print("Distance: ");
    Serial.println(lastDistanceCm);
    Serial.println();

    publishStatus(
      "",
      "obstacle_stop",
      "Obstacle detected under 8 cm. Robot stopped immediately.",
      "",
      "CMD,S"
    );

    publishEvent("obstacle_detected", "Obstacle detected under 8 cm. Emergency stop activated.");
  }

  if (obstacleStopActive && lastDistanceCm > OBSTACLE_CLEAR_DISTANCE_CM) {
    obstacleStopActive = false;

    Serial.println();
    Serial.println("Obstacle cleared.");
    Serial.print("Distance: ");
    Serial.println(lastDistanceCm);
    Serial.println();

    publishEvent("obstacle_cleared", "Obstacle distance is clear again.");
  }
}

// ================= PRODUCT IR SENSOR LOGIC =================
void resetProductDetectionCounters(int expectedCount) {
  cartIr1Count = 0;
  cartIr2Count = 0;
  cartProductCount = 0;
  expectedProductCount = expectedCount;
  productDetectionArmed = true;

  lastCartIr1State = digitalRead(CART_IR1_PIN);
  lastCartIr2State = digitalRead(CART_IR2_PIN);

  lastCartIr1TriggerTime = 0;
  lastCartIr2TriggerTime = 0;
  lastProductTriggerTime = 0;
}

void disarmProductDetectionIfComplete() {
  if (!productDetectionArmed) return;

  if (expectedProductCount > 0 && cartProductCount >= expectedProductCount) {
    productDetectionArmed = false;
    robotMode = "product_loaded";

    publishStatus(
      "",
      "product_loaded",
      "Expected product count detected in cart",
      "",
      "PRODUCT_COUNT_MATCHED"
    );

    publishEvent("product_loaded", "Robot cart detected expected product count");
  }
}

void countProductOnceIfAllowed() {
  unsigned long now = millis();

  if (now - lastProductTriggerTime >= PRODUCT_COUNT_COOLDOWN_MS) {
    lastProductTriggerTime = now;
    cartProductCount++;

    Serial.print("Cart product count: ");
    Serial.println(cartProductCount);

    publishEvent("product_detected", "Cart IR detected product/object");
    disarmProductDetectionIfComplete();
  }
}

void readCartIrSensors() {
  int ir1 = digitalRead(CART_IR1_PIN);
  int ir2 = digitalRead(CART_IR2_PIN);

  unsigned long now = millis();

  if (productDetectionArmed && lastCartIr1State == HIGH && ir1 == LOW) {
    if (now - lastCartIr1TriggerTime >= CART_IR_DEBOUNCE_MS) {
      lastCartIr1TriggerTime = now;
      cartIr1Count++;

      Serial.println("Cart IR1 object detected");

      countProductOnceIfAllowed();
    }
  }

  if (productDetectionArmed && lastCartIr2State == HIGH && ir2 == LOW) {
    if (now - lastCartIr2TriggerTime >= CART_IR_DEBOUNCE_MS) {
      lastCartIr2TriggerTime = now;
      cartIr2Count++;

      Serial.println("Cart IR2 object detected");

      countProductOnceIfAllowed();
    }
  }

  lastCartIr1State = ir1;
  lastCartIr2State = ir2;
}

// ================= GPS =================
void readGps() {
  while (GPSSerial.available()) {
    gps.encode(GPSSerial.read());
  }

  if (telemetryActive && millis() - lastGpsPrintTime >= 5000) {
    lastGpsPrintTime = millis();

    if (gps.location.isValid()) {
      Serial.print("GPS: ");
      Serial.print(gps.location.lat(), 6);
      Serial.print(", ");
      Serial.println(gps.location.lng(), 6);
    } else {
      Serial.println("GPS: waiting for fix...");
    }
  }
}

// ================= TELEMETRY LOOP =================
void startTelemetry(const String& commandId, JsonVariant params) {
  telemetryIntervalMs = getParamULong(params, "intervalMs", 1000);
  telemetryDurationMs = getParamULong(params, "durationMs", 600000);

  if (telemetryIntervalMs < 500) {
    telemetryIntervalMs = 500;
  }

  telemetryActive = true;
  telemetryStartedAt = millis();
  lastTelemetryTime = 0;

  publishStatus(
    commandId,
    "telemetry_started",
    "Robot telemetry started",
    "start_telemetry",
    "TELEMETRY_STARTED"
  );

  publishEvent("telemetry_started", "Robot telemetry window opened.");

  publishTelemetry();
}

void stopTelemetry(const String& commandId) {
  telemetryActive = false;

  publishStatus(
    commandId,
    "telemetry_stopped",
    "Robot telemetry stopped",
    "stop_telemetry",
    "TELEMETRY_STOPPED"
  );

  publishEvent("telemetry_stopped", "Robot telemetry window closed.");
}

void handleTelemetryLoop() {
  if (!telemetryActive) {
    return;
  }

  unsigned long now = millis();

  if (now - telemetryStartedAt >= telemetryDurationMs) {
    telemetryActive = false;
    publishEvent("telemetry_timeout", "Telemetry duration finished.");
    return;
  }

  if (now - lastTelemetryTime >= telemetryIntervalMs) {
    lastTelemetryTime = now;
    publishTelemetry();
  }
}

// ================= RETURN HOME =================
void executeReturnHomeCommand(const String& commandId, JsonVariant params, const String& sourceCommand) {
  if (obstacleStopActive) {
    robotMode = "obstacle_stop";

    sendToArduino("CMD,S");

    publishStatus(
      commandId,
      "blocked",
      "Return home blocked because obstacle is under 8 cm",
      sourceCommand,
      "OBSTACLE_ACTIVE"
    );

    publishEvent("obstacle_blocked_return_home", "Return home blocked because obstacle is under 8 cm");

    return;
  }

  String orderId = getParamString(params, "orderId", currentOrderId);
  String targetStation = getParamString(params, "targetStation", currentTargetStation);

  if (targetStation.length() == 0) {
    targetStation = "station_3";
  }

  if (!isValidStation(targetStation)) {
    robotMode = "error";

    publishStatus(
      commandId,
      "failed",
      "Invalid target station for return home",
      sourceCommand,
      "INVALID_STATION"
    );

    publishEvent("error", "Invalid target station received for return home");

    return;
  }

  if (!isSameOrderOrNoOrder(orderId)) {
    publishStatus(
      commandId,
      "failed",
      "Return home rejected because orderId does not match current order",
      sourceCommand,
      "ORDER_ID_MISMATCH"
    );

    publishEvent("return_home_rejected", "Order ID mismatch during return_home");

    return;
  }

  int stationNumber = stationStringToNumber(targetStation);

  currentOrderId = orderId;
  currentTargetStation = targetStation;
  autoTargetStation = stationNumber;
  updateUserLocationFromParams(params);

  activeReturnCommandId = commandId;
  activeDeliveryCommandId = commandId;

  deliveryAllowed = false;
  autoStarted = false;
  autoCancelled = false;
  autoFinished = false;
  returnHomeActive = true;
  productDetectionArmed = false;

  robotMode = "returning_home";

  String arduinoCommand = "RETURN_HOME,";
  arduinoCommand += stationNumber;

  sendToArduino(arduinoCommand);

  Serial.println();
  Serial.println("DELIVERY RECEIVED / RETURN HOME COMMAND");
  Serial.print("Order ID: ");
  Serial.println(currentOrderId);
  Serial.print("Target Station: ");
  Serial.println(currentTargetStation);
  Serial.print("Return command: ");
  Serial.println(arduinoCommand);
  Serial.println();

  publishStatus(
    commandId,
    "returning_home",
    "Delivery received. Robot returning home.",
    sourceCommand,
    arduinoCommand
  );

  publishEvent("returning_home", "Robot started return-home flow");
}

// ================= ARDUINO MESSAGE HANDLING =================
void processArduinoMessage(String message) {
  message.trim();

  if (message.length() == 0) {
    return;
  }

  Serial.print("Arduino -> ESP32: ");
  Serial.println(message);

  if (message == "ARDUINO_BOOTED") {
    markArduinoReady();
    return;
  }

  if (message.startsWith("ARDUINO_ACK")) {
    markArduinoReady();
    return;
  }

  if (message.startsWith("STATUS,")) {
    markArduinoReady();

    publishStatus(
      "",
      "arduino_status",
      message,
      "",
      message
    );

    return;
  }

  if (message.startsWith("LINE_STARTED")) {
    robotMode = returnHomeActive ? "return_line_following" : "line_following";

    Serial.println("Arduino started line following.");

    publishStatus(
      activeDeliveryCommandId,
      returnHomeActive ? "return_started" : "delivery_started",
      returnHomeActive ? "Arduino started return line following" : "Arduino started line following",
      returnHomeActive ? "return_home" : "start_delivery",
      message
    );

    publishEvent(
      returnHomeActive ? "return_started" : "delivery_started",
      returnHomeActive ? "Arduino confirmed return line following started" : "Arduino confirmed line following started"
    );

    return;
  }

  if (message.startsWith("RETURN_STARTED")) {
    returnHomeActive = true;
    robotMode = "returning_home";

    publishStatus(
      activeReturnCommandId,
      "return_started",
      "Arduino started return-home sequence",
      "return_home",
      message
    );

    publishEvent("return_started", "Arduino started return-home sequence");

    return;
  }

  if (message.startsWith("INITIAL_STATION_SKIPPED")) {
    Serial.println("Arduino skipped initial station.");

    publishEvent("initial_station_skipped", message);

    return;
  }

  if (message.startsWith("STATION_REACHED")) {
    Serial.println("Station event received.");

    publishStatus(
      activeDeliveryCommandId,
      returnHomeActive ? "return_station_reached" : "station_reached",
      returnHomeActive ? "Robot passed a station while returning home" : "Robot reached a station",
      returnHomeActive ? "return_home" : "start_delivery",
      message
    );

    publishEvent(
      returnHomeActive ? "return_station_reached" : "station_reached",
      message
    );

    return;
  }

  if (message.startsWith("HOME_REACHED")) {
    returnHomeActive = false;
    autoFinished = true;
    autoStarted = false;
    deliveryAllowed = false;
    robotMode = "home_reached";

    publishStatus(
      activeReturnCommandId,
      "home_reached",
      "Robot reached home/start point",
      "return_home",
      message
    );

    publishEvent("home_reached", "Robot reached home/start point");

    return;
  }

  if (message.startsWith("DONE,RETURN_HOME")) {
    returnHomeActive = false;
    autoFinished = true;
    autoStarted = false;
    deliveryAllowed = false;
    robotMode = "return_completed";

    Serial.println();
    Serial.println("RETURN HOME FINISHED.");
    Serial.println();

    publishStatus(
      activeReturnCommandId,
      "return_completed",
      "Robot returned home successfully",
      "return_home",
      message
    );

    publishEvent("return_completed", "Robot returned home successfully");

    return;
  }

  if (message.startsWith("DONE,LINE_TARGET")) {
    autoFinished = true;
    autoStarted = false;
    deliveryAllowed = false;
    robotMode = "delivery_completed";

    Serial.println();
    Serial.println("AUTO LINE MODE FINISHED.");
    Serial.println();

    publishStatus(
      activeDeliveryCommandId,
      "completed",
      "Robot delivery completed",
      "start_delivery",
      message
    );

    publishEvent("delivery_completed", "Robot reached target station and completed delivery");

    return;
  }

  if (message.startsWith("DONE,TURN")) {
    Serial.println("Gyro turn done.");

    publishEvent("turn_completed", message);

    return;
  }

  if (message.startsWith("ERROR,")) {
    robotMode = "error";

    Serial.print("Arduino error: ");
    Serial.println(message);

    publishStatus(
      returnHomeActive ? activeReturnCommandId : activeDeliveryCommandId,
      "failed",
      "Arduino error",
      returnHomeActive ? "return_home" : "",
      message
    );

    publishEvent("error", message);

    return;
  }

  if (message.startsWith("SAFETY_STOP")) {
    robotMode = "safety_stop";

    Serial.print("Arduino safety stop: ");
    Serial.println(message);

    publishStatus(
      returnHomeActive ? activeReturnCommandId : activeDeliveryCommandId,
      "failed",
      "Arduino safety stop",
      returnHomeActive ? "return_home" : "",
      message
    );

    publishEvent("safety_stop", message);

    return;
  }
}

void readArduinoSerial() {
  while (ArduinoSerial.available()) {
    char c = ArduinoSerial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      processArduinoMessage(arduinoLine);
      arduinoLine = "";
    } else {
      arduinoLine += c;
    }
  }
}

// ================= CAM MESSAGE HANDLING =================
void processCamMessage(String message) {
  message.trim();

  if (message.length() == 0) {
    return;
  }

  Serial.print("CAM -> DEVKIT: ");
  Serial.println(message);

  if (message == "CAM_BOOTED") {
    sendToCam("DEVKIT_ACK,CAM_BOOTED");
    publishEvent("cam_booted", "ESP32-CAM booted");
    return;
  }

  if (message == "CAM_CMD,READY") {
    sendToCam("DEVKIT_ACK,READY");
    publishEvent("cam_ready", "ESP32-CAM ready");
    return;
  }

  if (message == "CAM_CMD,MANUAL_ON") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,S");
    sendToCam("DEVKIT_ACK,MANUAL_ON");
    publishStatus("", "manual_on", "Manual mode enabled from CAM", "manual_on", "OK");
    return;
  }

  if (message == "CAM_CMD,MANUAL_OFF") {
    manualMode = false;
    sendToArduino("CMD,S");
    sendToCam("DEVKIT_ACK,MANUAL_OFF");
    publishStatus("", "manual_off", "Manual mode disabled from CAM", "manual_off", "OK");
    return;
  }

  if (message == "CAM_CMD,FWD") {
    cancelAutoForManual();
    sendToArduino("CMD,F");
    sendToCam("DEVKIT_ACK,FWD");
    return;
  }

  if (message == "CAM_CMD,BACK") {
    cancelAutoForManual();
    sendToArduino("CMD,B");
    sendToCam("DEVKIT_ACK,BACK");
    return;
  }

  if (message == "CAM_CMD,LEFT") {
    cancelAutoForManual();
    sendToArduino("CMD,L");
    sendToCam("DEVKIT_ACK,LEFT");
    return;
  }

  if (message == "CAM_CMD,RIGHT") {
    cancelAutoForManual();
    sendToArduino("CMD,R");
    sendToCam("DEVKIT_ACK,RIGHT");
    return;
  }

  if (message == "CAM_CMD,STOP") {
    cancelAutoForManual();
    sendToArduino("CMD,S");
    sendToCam("DEVKIT_ACK,STOP");
    return;
  }

  if (message == "CAM_CMD,LIGHT_ON") {
    sendToCam("DEVKIT_ACK,LIGHT_ON");
    return;
  }

  if (message == "CAM_CMD,LIGHT_OFF") {
    sendToCam("DEVKIT_ACK,LIGHT_OFF");
    return;
  }

  sendToCam("DEVKIT_ACK,UNKNOWN");
}

void readCamSerial() {
  while (CamSerial.available()) {
    char c = CamSerial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      processCamMessage(camLine);
      camLine = "";
    } else {
      camLine += c;
    }
  }
}

// ================= USB COMMANDS =================
void processUSBCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "A") {
    deliveryAllowed = true;
    activeDeliveryCommandId = "usb_manual_start";
    startAutoStationRun(3);
  } else if (command == "X") {
    autoCancelled = true;
    autoStarted = false;
    deliveryAllowed = false;
    returnHomeActive = false;
    sendToArduino("CMD,S");
  } else if (command == "1") {
    deliveryAllowed = true;
    activeDeliveryCommandId = "usb_station_1";
    startAutoStationRun(1);
  } else if (command == "2") {
    deliveryAllowed = true;
    activeDeliveryCommandId = "usb_station_2";
    startAutoStationRun(2);
  } else if (command == "3") {
    deliveryAllowed = true;
    activeDeliveryCommandId = "usb_station_3";
    startAutoStationRun(3);
  } else if (command == "4") {
    deliveryAllowed = true;
    activeDeliveryCommandId = "usb_station_4";
    startAutoStationRun(4);
  } else if (command == "F") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,F");
  } else if (command == "B") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,B");
  } else if (command == "L") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,L");
  } else if (command == "R") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,R");
  } else if (command == "S") {
    cancelAutoForManual();
    sendToArduino("CMD,S");
  } else if (command == "T") {
    cancelAutoForManual();
    sendToArduino("TURN,R,90");
  } else if (command == "P") {
    sendToArduino("PING");
  } else if (command == "STATUS") {
    sendToArduino("STATUS?");
    publishStatus("", "status_requested", "Status requested from Arduino", "status", "STATUS?");
  } else if (command == "HOME") {
    StaticJsonDocument<128> temp;
    JsonObject params = temp.to<JsonObject>();
    params["targetStation"] = currentTargetStation.length() > 0 ? currentTargetStation : "station_3";
    params["orderId"] = currentOrderId;
    executeReturnHomeCommand("usb_return_home", params, "return_home");
  } else {
    Serial.println("USB Commands:");
    Serial.println("A = auto go station 3");
    Serial.println("1/2/3/4 = auto go selected station");
    Serial.println("X = stop auto/return");
    Serial.println("F/B/L/R/S = manual motor command");
    Serial.println("T = test gyro right turn 90");
    Serial.println("P = ping Arduino");
    Serial.println("STATUS = request Arduino status");
    Serial.println("HOME = return home using current target station");
  }
}

void readUSBSerial() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      processUSBCommand(usbLine);
      usbLine = "";
    } else {
      usbLine += c;
    }
  }
}

// ================= MQTT COMMAND EXECUTION =================
void executePrepareForPickup(const String& commandId, JsonVariant params) {
  String orderId = getParamString(params, "orderId", "");
  String targetStation = getParamString(params, "targetStation", "station_3");

  int a = getParamInt(params, "a", 0);
  int b = getParamInt(params, "b", 0);
  int expectedProducts = getParamInt(params, "expectedProducts", a + b);

  if (expectedProducts <= 0) {
    expectedProducts = 1;
  }

  if (!isValidStation(targetStation)) {
    robotMode = "error";

    publishStatus(
      commandId,
      "failed",
      "Invalid target station for pickup",
      "prepare_for_pickup",
      "INVALID_STATION"
    );

    publishEvent("error", "Invalid target station received for pickup");

    return;
  }

  currentOrderId = orderId;
  currentTargetStation = targetStation;
  autoTargetStation = stationStringToNumber(targetStation);
  orderProductA = a;
  orderProductB = b;
  resetUserLocation();
  updateUserLocationFromParams(params);

  autoStarted = false;
  autoCancelled = false;
  autoFinished = false;
  deliveryAllowed = false;
  returnHomeActive = false;

  robotMode = "waiting_for_product";

  resetProductDetectionCounters(expectedProducts);

  Serial.println();
  Serial.println("Robot preparing for pickup");
  Serial.print("Order ID: ");
  Serial.println(currentOrderId);
  Serial.print("Target Station: ");
  Serial.println(currentTargetStation);
  Serial.print("Expected product count: ");
  Serial.println(expectedProductCount);
  Serial.print("User location available: ");
  Serial.println(userLocationAvailable ? "YES" : "NO");
  if (userLocationAvailable) {
    Serial.print("User lat/lng: ");
    Serial.print(userLatitude, 6);
    Serial.print(", ");
    Serial.println(userLongitude, 6);
  }
  Serial.println();

  sendToArduino("STATUS?");

  publishStatus(
    commandId,
    "ready_for_pickup",
    "Robot ready. Cart IR sensors armed for product detection.",
    "prepare_for_pickup",
    "READY_FOR_PICKUP"
  );

  publishEvent("robot_ready_for_pickup", "Robot sensors are ready for product pickup");
}

void executeStartDelivery(const String& commandId, JsonVariant params, bool simulated) {
  if (obstacleStopActive) {
    robotMode = "obstacle_stop";

    sendToArduino("CMD,S");

    publishStatus(
      commandId,
      "blocked",
      "Delivery start blocked because obstacle is under 8 cm",
      simulated ? "simulate_order_completed" : "start_delivery",
      "OBSTACLE_ACTIVE"
    );

    publishEvent("obstacle_blocked_delivery", "Delivery start blocked because obstacle is under 8 cm");

    return;
  }

  String orderId = getParamString(params, "orderId", currentOrderId);
  String targetStation = getParamString(params, "targetStation", currentTargetStation);

  if (targetStation.length() == 0) {
    targetStation = "station_3";
  }

  if (!isValidStation(targetStation)) {
    robotMode = "error";

    publishStatus(
      commandId,
      "failed",
      "Invalid target station",
      simulated ? "simulate_order_completed" : "start_delivery",
      "INVALID_STATION"
    );

    publishEvent("error", "Invalid target station received");

    return;
  }

  if (!isSameOrderOrNoOrder(orderId)) {
    publishStatus(
      commandId,
      "failed",
      "Start delivery rejected because orderId does not match current order",
      simulated ? "simulate_order_completed" : "start_delivery",
      "ORDER_ID_MISMATCH"
    );

    publishEvent("delivery_start_rejected", "Order ID mismatch during start_delivery");

    return;
  }

  if (autoStarted && !autoFinished && !autoCancelled) {
    publishStatus(
      commandId,
      "already_running",
      "Delivery already started, duplicate start ignored",
      simulated ? "simulate_order_completed" : "start_delivery",
      "DUPLICATE_START_IGNORED"
    );

    publishEvent("duplicate_start_delivery_ignored", "Duplicate start_delivery ignored by ESP32");

    return;
  }

  if (!simulated && !isCurrentOrderLoaded()) {
    robotMode = "waiting_for_product_loaded";

    publishStatus(
      commandId,
      "waiting_for_product_loaded",
      "Delivery blocked until cart IR product count reaches expectedProducts",
      "start_delivery",
      "WAITING_FOR_IR_PRODUCT_LOADED"
    );

    publishEvent("delivery_start_waiting_ir", "start_delivery ignored until cart productCount reaches expectedProducts");

    return;
  }

  currentOrderId = orderId;
  currentTargetStation = targetStation;
  autoTargetStation = stationStringToNumber(targetStation);
  updateUserLocationFromParams(params);

  deliveryAllowed = true;
  autoCancelled = false;
  autoFinished = false;
  returnHomeActive = false;
  activeDeliveryCommandId = commandId;

  robotMode = simulated ? "simulated_order_completed" : "delivery_waiting_to_start";

  Serial.println();
  if (simulated) {
    Serial.println("SIMULATED ORDER COMPLETED FLAG RECEIVED");
  } else {
    Serial.println("REAL START_DELIVERY COMMAND RECEIVED");
  }
  Serial.print("Order ID: ");
  Serial.println(currentOrderId);
  Serial.print("Target Station: ");
  Serial.println(currentTargetStation);
  Serial.print("Station number: ");
  Serial.println(autoTargetStation);
  Serial.println();

  if (arduinoReady) {
    startAutoStationRun(autoTargetStation);
  } else {
    sendToArduino("STATUS?");

    publishStatus(
      commandId,
      "delivery_queued",
      "Delivery queued. Waiting for Arduino ready.",
      simulated ? "simulate_order_completed" : "start_delivery",
      "WAITING_FOR_ARDUINO_READY"
    );
  }
}

void executeCancelDelivery(const String& commandId) {
  autoCancelled = true;
  autoStarted = false;
  deliveryAllowed = false;
  returnHomeActive = false;
  robotMode = "cancelled";

  sendToArduino("CMD,S");

  publishStatus(
    commandId,
    "cancelled",
    "Robot delivery/return cancelled",
    "cancel_delivery",
    "CMD,S"
  );

  publishEvent("delivery_cancelled", "Robot delivery/return cancelled");
}

void executeManualCommand(const String& commandId, const String& command) {
  if (obstacleStopActive && command != "stop" && command != "manual_off" && command != "status" && command != "ping") {
    publishStatus(
      commandId,
      "blocked",
      "Manual command blocked because obstacle is under 8 cm",
      command,
      "OBSTACLE_ACTIVE"
    );

    return;
  }

  if (command == "manual_on") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,S");

    publishStatus(commandId, "manual_on", "Manual mode enabled", command, "OK");
    return;
  }

  if (command == "manual_off") {
    manualMode = false;
    sendToArduino("CMD,S");
    robotMode = "idle";

    publishStatus(commandId, "manual_off", "Manual mode disabled", command, "OK");
    return;
  }

  if (command == "forward") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,F");
    publishStatus(commandId, "success", "Manual forward", command, "CMD,F");
    return;
  }

  if (command == "backward") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,B");
    publishStatus(commandId, "success", "Manual backward", command, "CMD,B");
    return;
  }

  if (command == "left") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,L");
    publishStatus(commandId, "success", "Manual left", command, "CMD,L");
    return;
  }

  if (command == "right") {
    manualMode = true;
    cancelAutoForManual();
    sendToArduino("CMD,R");
    publishStatus(commandId, "success", "Manual right", command, "CMD,R");
    return;
  }

  if (command == "stop") {
    sendToArduino("CMD,S");
    robotMode = "stopped";
    returnHomeActive = false;
    publishStatus(commandId, "success", "Robot stopped", command, "CMD,S");
    return;
  }

  if (command == "line_follow_on") {
    deliveryAllowed = true;
    activeDeliveryCommandId = commandId;
    startAutoStationRun(autoTargetStation);
    return;
  }

  if (command == "line_follow_off") {
    autoCancelled = true;
    autoStarted = false;
    deliveryAllowed = false;
    returnHomeActive = false;
    sendToArduino("CMD,S");
    robotMode = "idle";
    publishStatus(commandId, "success", "Line following stopped", command, "CMD,S");
    return;
  }

  if (command == "go_to_vending") {
    publishStatus(commandId, "not_implemented", "go_to_vending accepted but route not implemented yet", command, "NOT_IMPLEMENTED");
    return;
  }

  if (command == "delivery_loaded") {
    productDetectionArmed = false;
    if (expectedProductCount <= 0) {
      expectedProductCount = 1;
    }
    if (cartProductCount < expectedProductCount) {
      cartProductCount = expectedProductCount;
    }
    robotMode = "product_loaded";
    publishStatus(commandId, "product_loaded", "Delivery loaded flag received", command, "DELIVERY_LOADED");
    publishEvent("product_loaded", "Delivery loaded flag received from backend");
    return;
  }

  if (command == "status") {
    sendToArduino("STATUS?");
    publishStatus(commandId, "success", "Robot status requested", command, "STATUS?");
    return;
  }

  if (command == "ping") {
    publishStatus(commandId, "success", "Robot is online", command, "PONG");
    return;
  }

  publishStatus(commandId, "failed", "Command not implemented in robot ESP32", command, "NOT_IMPLEMENTED");
}

void handleCommandPayload(String rawPayload) {
  Serial.println();
  Serial.println("MQTT command received:");
  Serial.println(rawPayload);

  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, rawPayload);

  if (error) {
    publishStatus("", "failed", "Invalid JSON received", "", "JSON_PARSE_ERROR");
    return;
  }

  String commandId = doc["commandId"] | "";
  String deviceId = doc["deviceId"] | "";
  String command = doc["command"] | "";
  JsonVariant params = doc["params"];

  if (deviceId != DEVICE_ID) {
    Serial.println("Ignored command for another device");
    return;
  }

  if (commandId.length() == 0) {
    publishStatus("", "failed", "Missing commandId", command, "MISSING_COMMAND_ID");
    return;
  }

  if (command.length() == 0) {
    publishStatus(commandId, "failed", "Missing command", "", "MISSING_COMMAND");
    return;
  }

  if (!isAllowedCommand(command)) {
    publishStatus(commandId, "failed", "Invalid robot command", command, "INVALID_COMMAND");
    return;
  }

  if (commandId == lastCommandId) {
    Serial.println("Duplicate commandId received. Re-sending previous status.");

    if (lastStatusJson.length() > 0) {
      publishRawStatus(lastStatusJson);
    }

    return;
  }

  lastCommandId = commandId;

  if (command == "prepare_for_pickup") {
    executePrepareForPickup(commandId, params);
  } else if (command == "start_delivery" || command == "go_to_station") {
    executeStartDelivery(commandId, params, false);
  } else if (command == "simulate_order_completed") {
    executeStartDelivery(commandId, params, true);
  } else if (command == "delivery_received" || command == "return_home") {
    executeReturnHomeCommand(commandId, params, command);
  } else if (command == "cancel_delivery") {
    executeCancelDelivery(commandId);
  } else if (command == "start_telemetry") {
    startTelemetry(commandId, params);
  } else if (command == "stop_telemetry") {
    stopTelemetry(commandId);
  } else {
    executeManualCommand(commandId, command);
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String rawPayload = "";

  for (unsigned int i = 0; i < length; i++) {
    rawPayload += (char)payload[i];
  }

  handleCommandPayload(rawPayload);
}

// ================= WIFI / MQTT =================
void connectWiFi() {
  Serial.print("Connecting to WiFi");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    readArduinoSerial();
    readCamSerial();
    readUSBSerial();
    readCartIrSensors();
    handleUltrasonicSafety();
    readGps();

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

bool connectMqttOnce() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  String clientId = "esp32_" + String(DEVICE_ID) + "_" + String(random(1000, 9999));

  Serial.print("Connecting to MQTT... ");

  if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println("connected");

    mqttClient.subscribe(commandTopic.c_str(), 1);

    Serial.print("Subscribed to: ");
    Serial.println(commandTopic);

    publishOnlineStatus();

    return true;
  }

  Serial.print("failed, rc=");
  Serial.println(mqttClient.state());

  return false;
}

void ensureMqttConnected() {
  if (mqttClient.connected()) {
    return;
  }

  unsigned long now = millis();

  if (now - lastMqttReconnectAttempt < 3000) {
    return;
  }

  lastMqttReconnectAttempt = now;

  connectMqttOnce();
}

void handleHeartbeat() {
  if (millis() - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = millis();

    publishStatus(
      "",
      "heartbeat",
      "Robot heartbeat",
      "",
      "HEARTBEAT"
    );
  }
}

// ================= SETUP / LOOP =================
void setup() {
  Serial.begin(115200);

  CamSerial.begin(9600, SERIAL_8N1, CAM_RX_PIN, CAM_TX_PIN);
  ArduinoSerial.begin(9600, SERIAL_8N1, ARDUINO_RX_PIN, ARDUINO_TX_PIN);

  GPSSerial.begin(9600, SWSERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN, false);

  pinMode(CART_IR1_PIN, INPUT);
  pinMode(CART_IR2_PIN, INPUT);

  pinMode(ULTRASONIC_TRIG_PIN, OUTPUT);
  pinMode(ULTRASONIC_ECHO_PIN, INPUT);
  digitalWrite(ULTRASONIC_TRIG_PIN, LOW);

  delay(1000);

  Serial.println();
  Serial.println("================================");
  Serial.println("ESP32 DEVKIT MQTT ROUTER COMPLETE + RETURN HOME");
  Serial.println("================================");
  Serial.println("CAM link:");
  Serial.println("DevKit GPIO22 TX -> CAM IO14 RX");
  Serial.println("DevKit GPIO21 RX <- CAM IO13 TX");
  Serial.println();
  Serial.println("Arduino link:");
  Serial.println("DevKit GPIO27 TX -> Arduino D6 RX");
  Serial.println("DevKit GPIO26 RX <- Arduino D7 TX via level shifter");
  Serial.println();
  Serial.println("GPS:");
  Serial.println("GPS TX -> ESP32 GPIO16");
  Serial.println("GPS RX optional <- ESP32 GPIO17");
  Serial.println();
  Serial.println("Cart IR sensors:");
  Serial.println("IR1 OUT -> GPIO32");
  Serial.println("IR2 OUT -> GPIO35");
  Serial.println();
  Serial.println("Ultrasonic:");
  Serial.println("TRIG -> GPIO25");
  Serial.println("ECHO -> GPIO33 via voltage divider");
  Serial.println("Obstacle under 8 cm => immediate CMD,S");
  Serial.println();
  Serial.println("MQTT behavior:");
  Serial.println("prepare_for_pickup arms cart IR sensors.");
  Serial.println("start_delivery starts LINE,<station> after vending completion.");
  Serial.println("delivery_received sends RETURN_HOME,<station> to Arduino.");
  Serial.println("return_home manually sends RETURN_HOME,<station> to Arduino.");
  Serial.println("start_telemetry opens live GPS/cart/ultrasonic telemetry.");
  Serial.println("================================");
  Serial.println();

  connectWiFi();

  secureClient.setInsecure();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(4096);
  mqttClient.setKeepAlive(30);

  while (!mqttClient.connected()) {
    connectMqttOnce();
    delay(1000);
  }

  sendToArduino("STATUS?");
}

void loop() {
  readCamSerial();
  readArduinoSerial();
  readUSBSerial();

  readCartIrSensors();
  handleUltrasonicSafety();
  readGps();
  handleTelemetryLoop();

  handleAutoStart();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  ensureMqttConnected();

  if (mqttClient.connected()) {
    mqttClient.loop();
    handleHeartbeat();
  }
}