#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>


// WIFI SETTINGS

const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =====================================================
// MQTT / HIVEMQ SETTINGS
// =====================================================

const char* MQTT_HOST     = "YOUR_HIVEMQ_HOST";
const int   MQTT_PORT     = 8883;

const char* MQTT_USERNAME = "YOUR_MQTT_USERNAME";
const char* MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";

const char* DEVICE_ID = "VM001";


String commandTopic;
String statusTopic;
String eventTopic;

// =====================================================
// ESP32 PIN CONFIGURATION
// =====================================================

// Motor 1 - Product A
#define AIN1 18
#define AIN2 19
#define PWMA 5

// Motor 2 - Product B
#define BIN1 16
#define BIN2 17
#define PWMB 23

// TB6612 Enable
#define STBY 21

// IR Sensors
#define IR1 4
#define IR2 27

// =====================================================
// MOTOR SETTINGS
// =====================================================

#define MOTOR_SPEED 80

// Maximum time allowed for one item to be dispensed
#define MAX_DISPENSE_TIME_MS 8000

// Delay after item detection
#define SETTLE_TIME_MS 300

// =====================================================
// STOCK
// =====================================================

int qtyA = 10;
int qtyB = 10;

// =====================================================
// QUEUE
// =====================================================

#define QUEUE_SIZE 50

int dispenseQueue[QUEUE_SIZE];

int frontIndex = 0;
int rearIndex = 0;
int totalOrderItems = 0;
int dispensedCount = 0;

// =====================================================
// CURRENT DISPENSING STATE
// =====================================================

bool dispensing = false;

int currentProduct = 0;

unsigned long motorStartedAt = 0;
unsigned long itemDetectedAt = 0;

// =====================================================
// ORDER INFORMATION
// =====================================================

String activeOrderId = "";
String activeOrderCommandId = "";

bool doorLocked = false;

// =====================================================
// MQTT
// =====================================================

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

unsigned long lastMqttReconnectAttempt = 0;

// =====================================================
// FUNCTION DECLARATIONS
// =====================================================

void connectWiFi();
bool connectMqttOnce();
void ensureMqttConnected();

void onMqttMessage(
  char* topic,
  byte* payload,
  unsigned int length
);

void handleVendingLoop();

void startMotor1();
void stopMotor1();

void startMotor2();
void stopMotor2();

void stopAllMotors();

bool enqueue(int product);
bool dequeue(int &product);

bool startDispenseOrder(
  int a,
  int b,
  String orderId,
  String commandId
);

void startCurrentItem();
void finishCurrentItem();

void failCurrentOrder(String reason);
void completeOrderIfFinished();

void publishStatus();
void publishOnlineStatus();

void publishEvent(
  String eventName,
  String message
);

void handleDispenseCommand(JsonDocument &doc);
void handleRefillCommand(JsonDocument &doc);
void handleCommand(JsonDocument &doc);


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println("=================================");
  Serial.println(" SMART IoT VENDING MACHINE");
  Serial.println(" ESP32 + MQTT");
  Serial.println("=================================");

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);

  pinMode(BIN1, OUTPUT);
  pinMode(BIN2, OUTPUT);

  pinMode(STBY, OUTPUT);

  pinMode(IR1, INPUT);
  pinMode(IR2, INPUT);

  // Enable TB6612
  digitalWrite(STBY, HIGH);

  // ---------------------------------------------------
  // PWM CONFIGURATION
  // ---------------------------------------------------

  ledcAttach(PWMA, 1000, 8);
  ledcAttach(PWMB, 1000, 8);

  stopAllMotors();

  // ---------------------------------------------------
  // MQTT TOPICS
  // ---------------------------------------------------

  commandTopic = "devices/" + String(DEVICE_ID) + "/command";
  statusTopic  = "devices/" + String(DEVICE_ID) + "/status";
  eventTopic   = "devices/" + String(DEVICE_ID) + "/event";

  // ---------------------------------------------------
  // WIFI
  // ---------------------------------------------------

  connectWiFi();

  // ---------------------------------------------------
  // MQTT TLS
  // ---------------------------------------------------

  // For testing.
  // For production, use the HiveMQ CA certificate.
  secureClient.setInsecure();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);

  mqttClient.setCallback(onMqttMessage);

  mqttClient.setBufferSize(1024);

  mqttClient.setKeepAlive(30);

  // ---------------------------------------------------
  // CONNECT MQTT
  // ---------------------------------------------------

  while (!mqttClient.connected()) {

    connectMqttOnce();

    delay(1000);
  }

  Serial.println("System ready.");
}


// =====================================================
// MAIN LOOP
// =====================================================

void loop() {

  // Always process vending first
  handleVendingLoop();

  // ---------------------------------------------------
  // WIFI
  // ---------------------------------------------------

  if (WiFi.status() != WL_CONNECTED) {

    connectWiFi();
  }

  // ---------------------------------------------------
  // MQTT
  // ---------------------------------------------------

  ensureMqttConnected();

  if (mqttClient.connected()) {

    mqttClient.loop();
  }
}


// =====================================================
// WIFI CONNECTION
// =====================================================

void connectWiFi() {

  Serial.print("Connecting to WiFi");

  WiFi.mode(WIFI_STA);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  while (WiFi.status() != WL_CONNECTED) {

    handleVendingLoop();

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  Serial.println("WiFi connected.");

  Serial.print("IP address: ");

  Serial.println(
    WiFi.localIP()
  );
}


// =====================================================
// MQTT CONNECTION
// =====================================================

bool connectMqttOnce() {

  if (WiFi.status() != WL_CONNECTED) {

    return false;
  }

  String clientId =
    "esp32_" +
    String(DEVICE_ID) +
    "_" +
    String(random(1000, 9999));

  Serial.print("Connecting to MQTT... ");

  if (
    mqttClient.connect(
      clientId.c_str(),
      MQTT_USERNAME,
      MQTT_PASSWORD
    )
  ) {

    Serial.println("connected");

    mqttClient.subscribe(
      commandTopic.c_str(),
      1
    );

    Serial.print("Subscribed to: ");

    Serial.println(commandTopic);

    publishOnlineStatus();

    publishStatus();

    return true;
  }

  Serial.print("failed, rc=");

  Serial.println(
    mqttClient.state()
  );

  return false;
}


// =====================================================
// MQTT RECONNECT
// =====================================================

void ensureMqttConnected() {

  if (mqttClient.connected()) {

    return;
  }

  unsigned long now = millis();

  if (
    now - lastMqttReconnectAttempt <
    3000
  ) {

    return;
  }

  lastMqttReconnectAttempt = now;

  connectMqttOnce();
}


// =====================================================
// MQTT MESSAGE CALLBACK
// =====================================================

void onMqttMessage(
  char* topic,
  byte* payload,
  unsigned int length
) {

  Serial.println();
  Serial.println("MQTT message received.");

  // ---------------------------------------------------
  // Convert payload to String
  // ---------------------------------------------------

  String message = "";

  for (
    unsigned int i = 0;
    i < length;
    i++
  ) {

    message +=
      (char)payload[i];
  }

  Serial.print("Message: ");

  Serial.println(message);

  // ---------------------------------------------------
  // JSON DOCUMENT
  // ---------------------------------------------------

  JsonDocument doc;

  DeserializationError error =
    deserializeJson(
      doc,
      message
    );

  if (error) {

    Serial.print("JSON error: ");

    Serial.println(
      error.c_str()
    );

    publishEvent(
      "error",
      "Invalid JSON command"
    );

    return;
  }

  handleCommand(doc);
}


// =====================================================
// COMMAND HANDLER
// =====================================================

void handleCommand(JsonDocument &doc) {

  const char* command =
    doc["command"] | "";

  Serial.print("Command: ");

  Serial.println(command);

  // ---------------------------------------------------
  // PING
  // ---------------------------------------------------

  if (
    strcmp(command, "ping") == 0
  ) {

    publishEvent(
      "pong",
      "ESP32 is alive"
    );

    return;
  }

  // ---------------------------------------------------
  // STATUS
  // ---------------------------------------------------

  if (
    strcmp(command, "status") == 0
  ) {

    publishStatus();

    return;
  }

  // ---------------------------------------------------
  // DISPENSE
  // ---------------------------------------------------

  if (
    strcmp(command, "dispense") == 0
  ) {

    handleDispenseCommand(doc);

    return;
  }

  // ---------------------------------------------------
  // REFILL
  // ---------------------------------------------------

  if (
    strcmp(command, "refill") == 0
  ) {

    handleRefillCommand(doc);

    return;
  }

  // ---------------------------------------------------
  // RESET
  // ---------------------------------------------------

  if (
    strcmp(command, "reset") == 0
  ) {

    if (dispensing) {

      publishEvent(
        "error",
        "Cannot reset while dispensing"
      );

      return;
    }

    qtyA = 10;
    qtyB = 10;

    frontIndex = 0;
    rearIndex = 0;

    totalOrderItems = 0;
    dispensedCount = 0;

    activeOrderId = "";
    activeOrderCommandId = "";

    stopAllMotors();

    publishEvent(
      "reset",
      "Machine reset successfully"
    );

    publishStatus();

    return;
  }

  // ---------------------------------------------------
  // LOCK DOOR
  // ---------------------------------------------------

  if (
    strcmp(command, "lock_door") == 0
  ) {

    doorLocked = true;

    publishEvent(
      "door_locked",
      "Door locked"
    );

    return;
  }

  // ---------------------------------------------------
  // UNLOCK DOOR
  // ---------------------------------------------------

  if (
    strcmp(command, "unlock_door") == 0
  ) {

    doorLocked = false;

    publishEvent(
      "door_unlocked",
      "Door unlocked"
    );

    return;
  }

  // ---------------------------------------------------
  // UNKNOWN COMMAND
  // ---------------------------------------------------

  publishEvent(
    "error",
    "Unknown command"
  );
}


// =====================================================
// DISPENSE COMMAND
// =====================================================

void handleDispenseCommand(
  JsonDocument &doc
) {

  int a = doc["a"] | 0;
  int b = doc["b"] | 0;

  String orderId =
    doc["order_id"] | "";

  String commandId =
    doc["command_id"] | "";

  // ---------------------------------------------------
  // SLOT SUPPORT
  // ---------------------------------------------------

  const char* slot =
    doc["slot"] | "";

  int quantity =
    doc["quantity"] | 1;

  if (
    strlen(slot) > 0 &&
    quantity > 0
  ) {

    if (
      strcmp(slot, "A1") == 0
    ) {

      a = quantity;
      b = 0;
    }

    else if (
      strcmp(slot, "B1") == 0
    ) {

      a = 0;
      b = quantity;
    }
  }

  // ---------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------

  if (
    a < 0 ||
    b < 0 ||
    (a == 0 && b == 0)
  ) {

    publishEvent(
      "error",
      "Invalid dispense quantity"
    );

    return;
  }

  startDispenseOrder(
    a,
    b,
    orderId,
    commandId
  );
}


// =====================================================
// START DISPENSE ORDER
// =====================================================

bool startDispenseOrder(
  int a,
  int b,
  String orderId,
  String commandId
) {

  // ---------------------------------------------------
  // MACHINE BUSY
  // ---------------------------------------------------

  if (dispensing) {

    publishEvent(
      "order_rejected",
      "Machine is busy"
    );

    return false;
  }

  // ---------------------------------------------------
  // STOCK CHECK
  // ---------------------------------------------------

  if (a > qtyA) {

    publishEvent(
      "order_rejected",
      "Insufficient Product A stock"
    );

    return false;
  }

  if (b > qtyB) {

    publishEvent(
      "order_rejected",
      "Insufficient Product B stock"
    );

    return false;
  }

  // ---------------------------------------------------
  // QUEUE SPACE CHECK
  // ---------------------------------------------------

  if (
    a + b > QUEUE_SIZE
  ) {

    publishEvent(
      "order_rejected",
      "Order is too large"
    );

    return false;
  }

  // ---------------------------------------------------
  // CLEAR QUEUE
  // ---------------------------------------------------

  frontIndex = 0;
  rearIndex = 0;

  totalOrderItems = 0;
  dispensedCount = 0;

  // ---------------------------------------------------
  // ADD PRODUCT A
  // ---------------------------------------------------

  for (
    int i = 0;
    i < a;
    i++
  ) {

    enqueue(1);
  }

  // ---------------------------------------------------
  // ADD PRODUCT B
  // ---------------------------------------------------

  for (
    int i = 0;
    i < b;
    i++
  ) {

    enqueue(2);
  }

  activeOrderId =
    orderId;

  activeOrderCommandId =
    commandId;

  dispensing = true;

  currentProduct = 0;

  motorStartedAt = 0;

  itemDetectedAt = 0;

  // ---------------------------------------------------
  // ACCEPT ORDER
  // ---------------------------------------------------

  publishEvent(
    "order_accepted",
    "Order accepted"
  );

  Serial.print("Order accepted. Items: ");

  Serial.println(
    totalOrderItems
  );

  // ---------------------------------------------------
  // START FIRST ITEM
  // ---------------------------------------------------

  startCurrentItem();

  return true;
}


// =====================================================
// QUEUE - ENQUEUE
// =====================================================

bool enqueue(int product) {

  if (
    totalOrderItems >=
    QUEUE_SIZE
  ) {

    return false;
  }

  dispenseQueue[
    rearIndex
  ] = product;

  rearIndex =
    (rearIndex + 1) %
    QUEUE_SIZE;

  totalOrderItems++;

  return true;
}


// =====================================================
// QUEUE - DEQUEUE
// =====================================================

bool dequeue(int &product) {

  if (
    totalOrderItems <= 0
  ) {

    return false;
  }

  product =
    dispenseQueue[
      frontIndex
    ];

  frontIndex =
    (frontIndex + 1) %
    QUEUE_SIZE;

  totalOrderItems--;

  return true;
}


// =====================================================
// START CURRENT ITEM
// =====================================================

void startCurrentItem() {

  int product;

  if (
    !dequeue(product)
  ) {

    currentProduct = 0;

    completeOrderIfFinished();

    return;
  }

  currentProduct =
    product;

  motorStartedAt =
    millis();

  itemDetectedAt = 0;

  // ---------------------------------------------------
  // PRODUCT A
  // ---------------------------------------------------

  if (
    currentProduct == 1
  ) {

    startMotor1();

    publishEvent(
      "dispensing_item",
      "Dispensing Product A"
    );

    Serial.println(
      "Motor 1 started - Product A"
    );
  }

  // ---------------------------------------------------
  // PRODUCT B
  // ---------------------------------------------------

  else if (
    currentProduct == 2
  ) {

    startMotor2();

    publishEvent(
      "dispensing_item",
      "Dispensing Product B"
    );

    Serial.println(
      "Motor 2 started - Product B"
    );
  }
}


// =====================================================
// VENDING LOOP
// =====================================================

void handleVendingLoop() {

  if (!dispensing) {

    return;
  }

  unsigned long now =
    millis();

  // ---------------------------------------------------
  // PRODUCT A DETECTION
  // ---------------------------------------------------

  if (
    currentProduct == 1 &&
    digitalRead(IR1) == LOW
  ) {

    stopMotor1();

    itemDetectedAt =
      now;

    qtyA--;

    dispensedCount++;

    currentProduct = 0;

    motorStartedAt = 0;

    publishEvent(
      "item_dispensed",
      "Product A dispensed"
    );

    publishStatus();

    Serial.println(
      "Product A detected."
    );
  }

  // ---------------------------------------------------
  // PRODUCT B DETECTION
  // ---------------------------------------------------

  else if (
    currentProduct == 2 &&
    digitalRead(IR2) == LOW
  ) {

    stopMotor2();

    itemDetectedAt =
      now;

    qtyB--;

    dispensedCount++;

    currentProduct = 0;

    motorStartedAt = 0;

    publishEvent(
      "item_dispensed",
      "Product B dispensed"
    );

    publishStatus();

    Serial.println(
      "Product B detected."
    );
  }

  // ---------------------------------------------------
  // START NEXT ITEM AFTER SETTLE TIME
  // ---------------------------------------------------

  if (
    currentProduct == 0 &&
    totalOrderItems > 0
  ) {

    if (
      now - itemDetectedAt >=
      SETTLE_TIME_MS
    ) {

      startCurrentItem();
    }
  }

  // ---------------------------------------------------
  // DISPENSE TIMEOUT
  // ---------------------------------------------------

  if (
    dispensing &&
    motorStartedAt > 0 &&
    now - motorStartedAt >
      MAX_DISPENSE_TIME_MS
  ) {

    failCurrentOrder(
      "Dispense timeout: item not detected by IR sensor"
    );
  }

  // ---------------------------------------------------
  // COMPLETE ORDER
  // ---------------------------------------------------

  completeOrderIfFinished();
}


// =====================================================
// FINISH CURRENT ITEM
// =====================================================

void finishCurrentItem() {

  stopAllMotors();

  currentProduct = 0;

  motorStartedAt = 0;
}


// =====================================================
// FAIL CURRENT ORDER
// =====================================================

void failCurrentOrder(
  String reason
) {

  Serial.print(
    "ORDER FAILED: "
  );

  Serial.println(reason);

  stopAllMotors();

  dispensing = false;

  currentProduct = 0;

  motorStartedAt = 0;

  frontIndex = 0;
  rearIndex = 0;

  totalOrderItems = 0;

  publishEvent(
    "order_failed",
    reason
  );

  publishStatus();

  activeOrderId = "";
  activeOrderCommandId = "";
}


// =====================================================
// COMPLETE ORDER
// =====================================================

void completeOrderIfFinished() {

  if (
    !dispensing
  ) {

    return;
  }

  if (
    currentProduct == 0 &&
    totalOrderItems == 0
  ) {

    stopAllMotors();

    dispensing = false;

    publishEvent(
      "order_completed",
      "All products dispensed successfully"
    );

    publishStatus();

    Serial.println(
      "ORDER COMPLETED"
    );

    activeOrderId = "";
    activeOrderCommandId = "";
  }
}


// =====================================================
// MOTOR 1 - PRODUCT A
// =====================================================

void startMotor1() {

  digitalWrite(
    AIN1,
    HIGH
  );

  digitalWrite(
    AIN2,
    LOW
  );

  ledcWrite(
    PWMA,
    MOTOR_SPEED
  );
}


void stopMotor1() {

  ledcWrite(
    PWMA,
    0
  );

  digitalWrite(
    AIN1,
    LOW
  );

  digitalWrite(
    AIN2,
    LOW
  );
}


// =====================================================
// MOTOR 2 - PRODUCT B
// =====================================================

void startMotor2() {

  digitalWrite(
    BIN1,
    HIGH
  );

  digitalWrite(
    BIN2,
    LOW
  );

  ledcWrite(
    PWMB,
    MOTOR_SPEED
  );
}


void stopMotor2() {

  ledcWrite(
    PWMB,
    0
  );

  digitalWrite(
    BIN1,
    LOW
  );

  digitalWrite(
    BIN2,
    LOW
  );
}


// =====================================================
// STOP ALL MOTORS
// =====================================================

void stopAllMotors() {

  stopMotor1();

  stopMotor2();
}


// =====================================================
// REFILL COMMAND
// =====================================================

void handleRefillCommand(
  JsonDocument &doc
) {

  const char* pin =
    doc["pin"] | "";

  // ---------------------------------------------------
  // CHANGE THIS PIN
  // ---------------------------------------------------

  const char* ADMIN_PIN =
    "1234";

  if (
    strcmp(
      pin,
      ADMIN_PIN
    ) != 0
  ) {

    publishEvent(
      "error",
      "Invalid admin PIN"
    );

    return;
  }

  if (dispensing) {

    publishEvent(
      "error",
      "Cannot refill while dispensing"
    );

    return;
  }

  // ---------------------------------------------------
  // REFILL VALUES
  // ---------------------------------------------------

  if (doc["a"].is<int>()) {

    qtyA =
      doc["a"];
  }

  if (doc["b"].is<int>()) {

    qtyB =
      doc["b"];
  }

  publishEvent(
    "refill",
    "Stock refilled successfully"
  );

  publishStatus();
}


// =====================================================
// PUBLISH EVENT
// =====================================================

void publishEvent(
  String eventName,
  String message
) {

  if (
    !mqttClient.connected()
  ) {

    return;
  }

  JsonDocument doc;

  doc["event"] =
    eventName;

  doc["device_id"] =
    DEVICE_ID;

  doc["message"] =
    message;

  if (
    activeOrderId.length() > 0
  ) {

    doc["order_id"] =
      activeOrderId;
  }

  if (
    activeOrderCommandId.length() > 0
  ) {

    doc["command_id"] =
      activeOrderCommandId;
  }

  doc["qtyA"] =
    qtyA;

  doc["qtyB"] =
    qtyB;

  String output;

  serializeJson(
    doc,
    output
  );

  mqttClient.publish(
    eventTopic.c_str(),
    output.c_str(),
    true
  );

  Serial.print(
    "EVENT: "
  );

  Serial.println(output);
}


// =====================================================
// PUBLISH STATUS
// =====================================================

void publishStatus() {

  if (
    !mqttClient.connected()
  ) {

    return;
  }

  JsonDocument doc;

  doc["device_id"] =
    DEVICE_ID;

  doc["online"] =
    true;

  doc["dispensing"] =
    dispensing;

  doc["qtyA"] =
    qtyA;

  doc["qtyB"] =
    qtyB;

  doc["queue_items"] =
    totalOrderItems;

  doc["dispensed"] =
    dispensedCount;

  doc["current_product"] =
    currentProduct;

  doc["door_locked"] =
    doorLocked;

  String output;

  serializeJson(
    doc,
    output
  );

  mqttClient.publish(
    statusTopic.c_str(),
    output.c_str(),
    true
  );
}


// =====================================================
// PUBLISH ONLINE STATUS
// =====================================================

void publishOnlineStatus() {

  if (
    !mqttClient.connected()
  ) {

    return;
  }

  JsonDocument doc;

  doc["device_id"] =
    DEVICE_ID;

  doc["status"] =
    "online";

  doc["ip"] =
    WiFi.localIP().toString();

  String output;

  serializeJson(
    doc,
    output
  );

  mqttClient.publish(
    statusTopic.c_str(),
    output.c_str(),
    true
  );
}
