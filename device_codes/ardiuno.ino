#include <SoftwareSerial.h>
#include <Wire.h>
#include <math.h>

SoftwareSerial espLink(6, 7);

const byte LEFT_IN1 = 2;
const byte LEFT_IN2 = 3;
const byte RIGHT_IN1 = 4;
const byte RIGHT_IN2 = 5;

const byte LEFT_PWM = 9;
const byte RIGHT_PWM = 10;

const byte S1_PIN = A0;
const byte S2_PIN = A1;
const byte S3_PIN = A2;
const byte S4_PIN = A3;
const byte S5_PIN = 8;

const byte MPU_ADDR = 0x68;

const byte BLACK = 0;

const int MANUAL_SPEED = 200;

const int TURN_FAST_SPEED = 255;
const int TURN_SLOW_SPEED = 235;
const int TURN_BRAKE_SPEED = 185;

const int LINE_BASE_SPEED = 205;
const int LINE_MIN_SPEED = 160;
const int LINE_MAX_SPEED = 255;

const int LINE_KP = 28;
const int LINE_KD = 22;

const int LINE_STATION_SPEED = 185;

const int LINE_PIVOT_FAST = 255;
const int LINE_PIVOT_REVERSE = 230;

const int LINE_RECOVER_FAST = 255;
const int LINE_RECOVER_REVERSE = 230;
const int LINE_BACKUP_SPEED = 190;
const int LINE_REACQUIRE_FORWARD_SPEED = 175;

const int LINE_START_BOOST_SPEED = 225;


const float GYRO_SCALE = 131.0;
const float TURN_CORRECTION = 1.0019;

const float RIGHT_90_STOP_ANGLE = 78.0;
const float LEFT_90_STOP_ANGLE = 78.0;

const float RIGHT_180_STOP_ANGLE = 170.0;
const float LEFT_180_STOP_ANGLE = 170.0;

const float GYRO_DEADBAND_DPS = 0.80;
const float GYRO_SPIKE_LIMIT_DPS = 280.0;

const unsigned long TURN_TIMEOUT_MS = 60000;
const unsigned long TURN_BRAKE_MS = 120;

const unsigned long STATION_CONFIRM_MS = 70;
const unsigned long STATION_COOLDOWN_MS = 650;

const unsigned long MANUAL_TIMEOUT_MS = 8000;
const unsigned long LINE_PRINT_MS = 300;

const unsigned long LINE_START_BOOST_MS = 350;
const unsigned long LINE_LOST_SIMPLE_SPIN_MS = 20000;
const unsigned long LINE_LOST_LONG_REPORT_MS = 60000;

const unsigned long RECOVERY_PIVOT_MS = 1800;
const unsigned long RECOVERY_BACKUP_MS = 750;
const unsigned long RECOVERY_OPPOSITE_PIVOT_MS = 900;
const unsigned long RECOVERY_FORWARD_MS = 700;

const char RETURN_TURN_DIRECTION = 'R';
const float RETURN_TURN_ANGLE = 180.0;


const byte MAX_STATION_TARGET = 4;

enum RobotMode {
  MODE_IDLE,
  MODE_MANUAL,
  MODE_LINE,
  MODE_RETURN
};

RobotMode robotMode = MODE_IDLE;

char rxBuf[48];
byte rxIndex = 0;

byte lineValue[5];

float gyroZOffset = 0.0;
float yawDeg = 0.0;
float lastGoodGyroRate = 0.0;
unsigned long lastGyroMicros = 0;

bool mpuReady = false;

int targetStation = 0;
int stationCount = 0;
bool stationLocked = false;
unsigned long stationSeenAt = 0;
unsigned long lastStationCountTime = 0;

int lastLineError = 0;
int previousLineError = 0;
int lastKnownLineSide = 0;

bool recoveringLine = false;
bool lineLongReported = false;

byte recoveryPhase = 0;
unsigned long recoveryStartedAt = 0;
unsigned long recoveryPhaseStartedAt = 0;

unsigned long lineStartedAt = 0;
unsigned long lastLineSeenAt = 0;
unsigned long lastLinePrint = 0;
unsigned long lastManualTime = 0;

void setLeftMotor(int speedValue) {
  int pwm = abs(speedValue);
  pwm = constrain(pwm, 0, 255);

  if (speedValue > 0) {
    digitalWrite(LEFT_IN1, HIGH);
    digitalWrite(LEFT_IN2, LOW);
  } else if (speedValue < 0) {
    digitalWrite(LEFT_IN1, LOW);
    digitalWrite(LEFT_IN2, HIGH);
  } else {
    digitalWrite(LEFT_IN1, LOW);
    digitalWrite(LEFT_IN2, LOW);
  }

  analogWrite(LEFT_PWM, pwm);
}

void setRightMotor(int speedValue) {
  int pwm = abs(speedValue);
  pwm = constrain(pwm, 0, 255);

  if (speedValue > 0) {
    digitalWrite(RIGHT_IN1, HIGH);
    digitalWrite(RIGHT_IN2, LOW);
  } else if (speedValue < 0) {
    digitalWrite(RIGHT_IN1, LOW);
    digitalWrite(RIGHT_IN2, HIGH);
  } else {
    digitalWrite(RIGHT_IN1, LOW);
    digitalWrite(RIGHT_IN2, LOW);
  }

  analogWrite(RIGHT_PWM, pwm);
}

void setMotors(int leftSpeed, int rightSpeed) {
  setLeftMotor(leftSpeed);
  setRightMotor(rightSpeed);
}

void stopMotors() {
  setMotors(0, 0);
}

void sendFlash(const __FlashStringHelper *msg) {
  espLink.println(msg);
  Serial.print(F("Arduino -> ESP32: "));
  Serial.println(msg);
}

void sendStationEvent() {
  espLink.print(F("STATION_REACHED,"));
  espLink.print(stationCount);
  espLink.print(F(",TARGET,"));
  espLink.println(targetStation);

  Serial.print(F("Station reached: "));
  Serial.print(stationCount);
  Serial.print(F(" / "));
  Serial.println(targetStation);
}

void sendLineDone() {
  espLink.print(F("DONE,LINE_TARGET,"));
  espLink.print(targetStation);
  espLink.print(F(",COUNT,"));
  espLink.println(stationCount);

  Serial.println(F("Arduino -> ESP32: DONE,LINE_TARGET"));
}

void sendReturnStarted() {
  espLink.print(F("RETURN_STARTED,TARGET,"));
  espLink.println(targetStation);

  Serial.print(F("Arduino -> ESP32: RETURN_STARTED,TARGET,"));
  Serial.println(targetStation);
}

void sendHomeReached() {
  espLink.print(F("HOME_REACHED,TARGET,"));
  espLink.print(targetStation);
  espLink.print(F(",COUNT,"));
  espLink.println(stationCount);

  Serial.println(F("Arduino -> ESP32: HOME_REACHED"));
}

void sendReturnDone() {
  espLink.print(F("DONE,RETURN_HOME,TARGET,"));
  espLink.print(targetStation);
  espLink.print(F(",COUNT,"));
  espLink.println(stationCount);

  Serial.println(F("Arduino -> ESP32: DONE,RETURN_HOME"));
}


void sendTurnDone(char direction, float requestedAngle) {
  espLink.print(F("DONE,TURN,"));
  espLink.print(direction);
  espLink.print(',');
  espLink.print(requestedAngle, 0);
  espLink.print(F(",YAW,"));
  espLink.println(yawDeg, 2);

  Serial.println(F("Arduino -> ESP32: DONE,TURN"));
}

bool wakeMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0);
  return Wire.endTransmission() == 0;
}

int16_t readGyroZOnce() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x47);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, (byte)2, (byte)true);

  if (Wire.available() < 2) {
    return 0;
  }

  return (int16_t)((Wire.read() << 8) | Wire.read());
}

int16_t readGyroZAverage() {
  long sum = 0;

  for (byte i = 0; i < 5; i++) {
    sum += readGyroZOnce();
  }

  return (int16_t)(sum / 5);
}

void calibrateGyroZ() {
  Serial.println(F("Keep robot still. Calibrating MPU6050..."));

  long sum = 0;
  const int samples = 1200;

  for (int i = 0; i < samples; i++) {
    sum += readGyroZOnce();
    delay(2);
  }

  gyroZOffset = (float)sum / samples;

  Serial.print(F("Gyro Z offset: "));
  Serial.println(gyroZOffset);
}

void resetYaw() {
  yawDeg = 0.0;
  lastGoodGyroRate = 0.0;
  lastGyroMicros = micros();
}

void updateYaw() {
  unsigned long nowMicros = micros();
  float dt = (nowMicros - lastGyroMicros) / 1000000.0;
  lastGyroMicros = nowMicros;

  int16_t rawZ = readGyroZAverage();
  float rate = (rawZ - gyroZOffset) / GYRO_SCALE;

  if (fabs(rate) < GYRO_DEADBAND_DPS) {
    rate = 0.0;
  }

  if (fabs(rate) > GYRO_SPIKE_LIMIT_DPS) {
    rate = lastGoodGyroRate;
  } else {
    lastGoodGyroRate = rate;
  }

  yawDeg += rate * dt * TURN_CORRECTION;
}

float getStopAngle(char direction, float requestedAngle) {
  if (requestedAngle >= 170.0 && requestedAngle <= 190.0) {
    if (direction == 'R') {
      return RIGHT_180_STOP_ANGLE;
    }

    return LEFT_180_STOP_ANGLE;
  }

  if (requestedAngle >= 85.0 && requestedAngle <= 95.0) {
    if (direction == 'R') {
      return RIGHT_90_STOP_ANGLE;
    }

    return LEFT_90_STOP_ANGLE;
  }

  return requestedAngle * 0.90;
}

void brakeTurn(char direction) {
  if (direction == 'R') {
    setMotors(-TURN_BRAKE_SPEED, TURN_BRAKE_SPEED);
  } else {
    setMotors(TURN_BRAKE_SPEED, -TURN_BRAKE_SPEED);
  }

  delay(TURN_BRAKE_MS);
  stopMotors();
  delay(200);
}

void uppercase(char *cmd) {
  for (byte i = 0; cmd[i] != '\0'; i++) {
    if (cmd[i] >= 'a' && cmd[i] <= 'z') {
      cmd[i] = cmd[i] - 32;
    }
  }
}

bool pollStopDuringTurn() {
  while (espLink.available()) {
    char c = espLink.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      rxBuf[rxIndex] = '\0';
      uppercase(rxBuf);

      bool stopNow = strcmp(rxBuf, "CMD,S") == 0 || strcmp(rxBuf, "STOP") == 0;

      rxIndex = 0;

      if (stopNow) {
        stopMotors();
        sendFlash(F("ARDUINO_ACK,CMD,S"));
        return true;
      }
    } else {
      if (rxIndex < sizeof(rxBuf) - 1) {
        rxBuf[rxIndex++] = c;
      } else {
        rxIndex = 0;
      }
    }
  }

  return false;
}

bool gyroTurn(char direction, float requestedAngle) {
  if (!mpuReady) {
    stopMotors();
    sendFlash(F("ERROR,MPU_NOT_READY"));
    return false;
  }

  robotMode = MODE_IDLE;
  stopMotors();
  delay(150);

  requestedAngle = fabs(requestedAngle);
  float stopAngle = getStopAngle(direction, requestedAngle);

  Serial.print(F("Turn start: "));
  Serial.print(direction);
  Serial.print(F(" requested "));
  Serial.print(requestedAngle);
  Serial.print(F(" stop "));
  Serial.println(stopAngle);

  resetYaw();

  unsigned long startMs = millis();

  while (true) {
    updateYaw();

    float signedAngle = direction == 'R' ? -yawDeg : yawDeg;

    if (signedAngle >= stopAngle) {
      break;
    }

    float remaining = stopAngle - signedAngle;
    int speedNow = remaining < 12.0 ? TURN_SLOW_SPEED : TURN_FAST_SPEED;

    if (direction == 'R') {
      setMotors(speedNow, -speedNow);
    } else {
      setMotors(-speedNow, speedNow);
    }

    if (pollStopDuringTurn()) {
      stopMotors();
      sendFlash(F("DONE,TURN_ABORTED"));
      return false;
    }

    if (millis() - startMs > TURN_TIMEOUT_MS) {
      stopMotors();
      sendFlash(F("ERROR,TURN_TIMEOUT"));
      return false;
    }

    delay(4);
  }

  brakeTurn(direction);
  sendTurnDone(direction, requestedAngle);

  return true;
}

void readLineSensors() {
  lineValue[0] = digitalRead(S1_PIN);
  lineValue[1] = digitalRead(S2_PIN);
  lineValue[2] = digitalRead(S3_PIN);
  lineValue[3] = digitalRead(S4_PIN);
  lineValue[4] = digitalRead(S5_PIN);
}

bool isBlack(byte index) {
  return lineValue[index] == BLACK;
}

bool isStation() {
  return isBlack(0) &&
         isBlack(1) &&
         isBlack(2) &&
         isBlack(3) &&
         isBlack(4);
}

byte blackCount() {
  byte count = 0;

  for (byte i = 0; i < 5; i++) {
    if (isBlack(i)) {
      count++;
    }
  }

  return count;
}

int lineError() {
  long sum = 0;
  byte count = 0;

  if (isBlack(0)) {
    sum -= 4;
    count++;
  }

  if (isBlack(1)) {
    sum -= 2;
    count++;
  }

  if (isBlack(2)) {
    count++;
  }

  if (isBlack(3)) {
    sum += 2;
    count++;
  }

  if (isBlack(4)) {
    sum += 4;
    count++;
  }

  if (count == 0) {
    return 99;
  }

  int error = sum / count;

  if (error < 0) {
    lastKnownLineSide = -1;
  } else if (error > 0) {
    lastKnownLineSide = 1;
  }

  lastLineError = error;
  lastLineSeenAt = millis();

  return error;
}

void printLineDebug() {
  if (millis() - lastLinePrint < LINE_PRINT_MS) {
    return;
  }

  lastLinePrint = millis();

  Serial.print(F("Line: "));

  for (byte i = 0; i < 5; i++) {
    Serial.print(lineValue[i]);
  }

  Serial.print(F(" BlackCount "));
  Serial.print(blackCount());

  Serial.print(F(" Mode "));
  if (robotMode == MODE_IDLE) {
    Serial.print(F("IDLE"));
  } else if (robotMode == MODE_MANUAL) {
    Serial.print(F("MANUAL"));
  } else if (robotMode == MODE_LINE) {
    Serial.print(F("LINE"));
  } else {
    Serial.print(F("RETURN"));
  }

  Serial.print(F(" Station "));
  Serial.print(stationCount);
  Serial.print('/');
  Serial.print(targetStation);

  Serial.print(F(" Err "));
  Serial.print(lastLineError);

  Serial.print(F(" LastSide "));
  Serial.print(lastKnownLineSide);

  Serial.print(F(" Recover "));
  if (recoveringLine) {
    Serial.println(F("YES"));
  } else {
    Serial.println(F("NO"));
  }
}

void finishLineTarget() {
  stopMotors();

  RobotMode finishedMode = robotMode;

  robotMode = MODE_IDLE;
  recoveringLine = false;

  if (finishedMode == MODE_RETURN) {
    sendHomeReached();
    delay(100);
    sendReturnDone();
  } else {
    sendLineDone();
  }
}

void updateStationCounter() {
  bool stationNow = isStation();
  unsigned long now = millis();


  if (stationNow) {
    if (stationLocked) {
      return;
    }

    if (now - lastStationCountTime < STATION_COOLDOWN_MS) {
      return;
    }

    if (stationSeenAt == 0) {
      stationSeenAt = now;
      return;
    }

    if (now - stationSeenAt >= STATION_CONFIRM_MS) {
      stationCount++;
      stationLocked = true;
      stationSeenAt = 0;
      lastStationCountTime = now;

      sendStationEvent();

      if (stationCount >= targetStation) {
        finishLineTarget();
      }
    }

    return;
  }

  stationSeenAt = 0;
  stationLocked = false;
}

void pivotTowardLastLine() {
  if (lastKnownLineSide < 0) {
    setMotors(-LINE_RECOVER_REVERSE, LINE_RECOVER_FAST);
  } else if (lastKnownLineSide > 0) {
    setMotors(LINE_RECOVER_FAST, -LINE_RECOVER_REVERSE);
  } else {
    setMotors(LINE_RECOVER_FAST, -LINE_RECOVER_REVERSE);
  }
}

void pivotOppositeLastLine() {
  if (lastKnownLineSide < 0) {
    setMotors(LINE_RECOVER_FAST, -LINE_RECOVER_REVERSE);
  } else if (lastKnownLineSide > 0) {
    setMotors(-LINE_RECOVER_REVERSE, LINE_RECOVER_FAST);
  } else {
    setMotors(-LINE_RECOVER_REVERSE, LINE_RECOVER_FAST);
  }
}

void recoverLine() {
  unsigned long now = millis();

  if (!recoveringLine) {
    recoveringLine = true;
    lineLongReported = false;
    recoveryPhase = 0;
    recoveryStartedAt = now;
    recoveryPhaseStartedAt = now;

    sendFlash(F("LINE_LOST,RECOVERING"));
  }

  unsigned long lostFor = now - recoveryStartedAt;

  if (lostFor >= LINE_LOST_LONG_REPORT_MS && !lineLongReported) {
    lineLongReported = true;
    sendFlash(F("ERROR,LINE_LOST_LONG_KEEP_SEARCHING"));
  }

  if (lostFor < LINE_LOST_SIMPLE_SPIN_MS) {
    pivotTowardLastLine();
    printLineDebug();
    return;
  }

  unsigned long phaseTime = now - recoveryPhaseStartedAt;

  if (recoveryPhase == 0) {
    pivotTowardLastLine();

    if (phaseTime >= RECOVERY_PIVOT_MS) {
      recoveryPhase = 1;
      recoveryPhaseStartedAt = now;
    }
  } else if (recoveryPhase == 1) {
    setMotors(-LINE_BACKUP_SPEED, -LINE_BACKUP_SPEED);

    if (phaseTime >= RECOVERY_BACKUP_MS) {
      recoveryPhase = 2;
      recoveryPhaseStartedAt = now;
    }
  } else if (recoveryPhase == 2) {
    pivotOppositeLastLine();

    if (phaseTime >= RECOVERY_OPPOSITE_PIVOT_MS) {
      recoveryPhase = 3;
      recoveryPhaseStartedAt = now;
    }
  } else {
    setMotors(LINE_REACQUIRE_FORWARD_SPEED, LINE_REACQUIRE_FORWARD_SPEED);

    if (phaseTime >= RECOVERY_FORWARD_MS) {
      recoveryPhase = 0;
      recoveryPhaseStartedAt = now;
    }
  }

  printLineDebug();
}

void followLineStep() {
  readLineSensors();

  updateStationCounter();

  if (robotMode != MODE_LINE && robotMode != MODE_RETURN) {
    return;
  }

  if (isStation()) {
    setMotors(LINE_STATION_SPEED, LINE_STATION_SPEED);
    printLineDebug();
    return;
  }

  byte count = blackCount();

  if (count == 0) {
    recoverLine();
    return;
  }

  if (recoveringLine) {
    recoveringLine = false;
    lineLongReported = false;
    recoveryPhase = 0;
    sendFlash(F("LINE_REACQUIRED"));
  }

  if (millis() - lineStartedAt < LINE_START_BOOST_MS) {
    setMotors(LINE_START_BOOST_SPEED, LINE_START_BOOST_SPEED);
    printLineDebug();
    return;
  }

  if (isBlack(0) && !isBlack(4)) {
    lastKnownLineSide = -1;
    lastLineError = -4;
    setMotors(-LINE_PIVOT_REVERSE, LINE_PIVOT_FAST);
    printLineDebug();
    return;
  }

  if (isBlack(4) && !isBlack(0)) {
    lastKnownLineSide = 1;
    lastLineError = 4;
    setMotors(LINE_PIVOT_FAST, -LINE_PIVOT_REVERSE);
    printLineDebug();
    return;
  }

  int error = lineError();
  int derivative = error - previousLineError;
  previousLineError = error;

  int correction = (LINE_KP * error) + (LINE_KD * derivative);

  int leftSpeed = LINE_BASE_SPEED + correction;
  int rightSpeed = LINE_BASE_SPEED - correction;

  leftSpeed = constrain(leftSpeed, LINE_MIN_SPEED, LINE_MAX_SPEED);
  rightSpeed = constrain(rightSpeed, LINE_MIN_SPEED, LINE_MAX_SPEED);

  setMotors(leftSpeed, rightSpeed);
  printLineDebug();
}

void resetLineFollowState(byte stationTarget) {
  targetStation = stationTarget;
  stationCount = 0;
  stationSeenAt = 0;
  lastStationCountTime = 0;
  stationLocked = isStation();

  lastLineError = 0;
  previousLineError = 0;
  lastKnownLineSide = 0;

  recoveringLine = false;
  lineLongReported = false;
  recoveryPhase = 0;

  lineStartedAt = millis();
  lastLineSeenAt = millis();
}

void startLineFollow(byte stationTarget) {
  if (stationTarget == 0 || stationTarget > MAX_STATION_TARGET) {
    sendFlash(F("ERROR,INVALID_STATION_TARGET"));
    return;
  }

  readLineSensors();
  resetLineFollowState(stationTarget);

  robotMode = MODE_LINE;

  espLink.print(F("LINE_STARTED,TARGET,"));
  espLink.println(targetStation);

  Serial.print(F("Line follow target: "));
  Serial.println(targetStation);

  if (stationLocked) {
    sendFlash(F("INITIAL_STATION_SKIPPED"));
  }
}

void startReturnLineFollow(byte stationTarget) {
  if (stationTarget == 0 || stationTarget > MAX_STATION_TARGET) {
    sendFlash(F("ERROR,INVALID_RETURN_TARGET"));
    return;
  }

  readLineSensors();
  resetLineFollowState(stationTarget);

  robotMode = MODE_RETURN;

  sendReturnStarted();

  Serial.print(F("Return line follow target: "));
  Serial.println(targetStation);

  if (stationLocked) {
    sendFlash(F("INITIAL_STATION_SKIPPED"));
  }
}

void startReturnHome(byte stationTarget) {
  if (stationTarget == 0 || stationTarget > MAX_STATION_TARGET) {
    sendFlash(F("ERROR,INVALID_RETURN_TARGET"));
    return;
  }

  stopMotors();
  robotMode = MODE_IDLE;
  recoveringLine = false;

  espLink.print(F("RETURN_STARTED,TURNING,TARGET,"));
  espLink.println(stationTarget);

  Serial.print(F("Return home requested from station "));
  Serial.println(stationTarget);
  Serial.println(F("Turning 180 degrees before return line follow..."));

  bool turned = gyroTurn(RETURN_TURN_DIRECTION, RETURN_TURN_ANGLE);

  if (!turned) {
    stopMotors();
    sendFlash(F("ERROR,RETURN_TURN_FAILED"));
    return;
  }

  delay(300);

  startReturnLineFollow(stationTarget);
}

void manualCommand(char action) {
  robotMode = MODE_MANUAL;
  recoveringLine = false;
  lastManualTime = millis();

  if (action == 'F') {
    setMotors(MANUAL_SPEED, MANUAL_SPEED);
    sendFlash(F("ARDUINO_ACK,CMD,F"));
  } else if (action == 'B') {
    setMotors(-MANUAL_SPEED, -MANUAL_SPEED);
    sendFlash(F("ARDUINO_ACK,CMD,B"));
  } else if (action == 'L') {
    setMotors(-TURN_FAST_SPEED, TURN_FAST_SPEED);
    sendFlash(F("ARDUINO_ACK,CMD,L"));
  } else if (action == 'R') {
    setMotors(TURN_FAST_SPEED, -TURN_FAST_SPEED);
    sendFlash(F("ARDUINO_ACK,CMD,R"));
  } else if (action == 'S') {
    robotMode = MODE_IDLE;
    recoveringLine = false;
    stopMotors();
    sendFlash(F("ARDUINO_ACK,CMD,S"));
  }
}

void sendStatus() {
  espLink.print(F("STATUS,MODE,"));

  if (robotMode == MODE_IDLE) {
    espLink.print(F("IDLE"));
  } else if (robotMode == MODE_MANUAL) {
    espLink.print(F("MANUAL"));
  } else if (robotMode == MODE_LINE) {
    espLink.print(F("LINE"));
  } else {
    espLink.print(F("RETURN"));
  }

  espLink.print(F(",STATION,"));
  espLink.print(stationCount);
  espLink.print('/');
  espLink.print(targetStation);

  espLink.print(F(",RECOVER,"));
  if (recoveringLine) {
    espLink.println(F("YES"));
  } else {
    espLink.println(F("NO"));
  }

  Serial.println(F("Arduino -> ESP32: STATUS"));
}

void processCommand(char *cmd) {
  uppercase(cmd);

  Serial.print(F("Arduino received: "));
  Serial.println(cmd);

  if (strcmp(cmd, "PING") == 0) {
    sendFlash(F("ARDUINO_ACK,PING"));
    return;
  }

  if (strcmp(cmd, "STATUS?") == 0) {
    sendStatus();
    return;
  }

  if (strncmp(cmd, "CMD,", 4) == 0) {
    manualCommand(cmd[4]);
    return;
  }

  if (strncmp(cmd, "TURN,", 5) == 0) {
    char direction = cmd[5];
    int angle = atoi(cmd + 7);

    if (direction == 'L' || direction == 'R') {
      gyroTurn(direction, angle);
    }

    return;
  }


  if (strncmp(cmd, "LINE,", 5) == 0) {
    byte stationTarget = atoi(cmd + 5);
    startLineFollow(stationTarget);
    return;
  }

  if (strncmp(cmd, "RETURN_HOME,", 12) == 0) {
    byte stationTarget = atoi(cmd + 12);
    startReturnHome(stationTarget);
    return;
  }

  if (strcmp(cmd, "LINE_STOP") == 0) {
    robotMode = MODE_IDLE;
    recoveringLine = false;
    stopMotors();
    sendFlash(F("ARDUINO_ACK,LINE_STOP"));
    return;
  }

  sendFlash(F("ERROR,UNKNOWN_COMMAND"));
}

void readESP32Serial() {
  while (espLink.available()) {
    char c = espLink.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      rxBuf[rxIndex] = '\0';

      if (rxIndex > 0) {
        processCommand(rxBuf);
      }

      rxIndex = 0;
    } else {
      if (rxIndex < sizeof(rxBuf) - 1) {
        rxBuf[rxIndex++] = c;
      } else {
        rxIndex = 0;
      }
    }
  }
}

void handleManualTimeout() {
  if (robotMode != MODE_MANUAL) {
    return;
  }

  if (millis() - lastManualTime > MANUAL_TIMEOUT_MS) {
    robotMode = MODE_IDLE;
    recoveringLine = false;
    stopMotors();
    sendFlash(F("SAFETY_STOP,MANUAL_TIMEOUT"));
  }
}

void setup() {
  Serial.begin(115200);
  espLink.begin(9600);

  pinMode(LEFT_IN1, OUTPUT);
  pinMode(LEFT_IN2, OUTPUT);
  pinMode(RIGHT_IN1, OUTPUT);
  pinMode(RIGHT_IN2, OUTPUT);
  pinMode(LEFT_PWM, OUTPUT);
  pinMode(RIGHT_PWM, OUTPUT);

  pinMode(S1_PIN, INPUT);
  pinMode(S2_PIN, INPUT);
  pinMode(S3_PIN, INPUT);
  pinMode(S4_PIN, INPUT);
  pinMode(S5_PIN, INPUT);

  stopMotors();

  Wire.begin();

  delay(700);

  Serial.println(F("Arduino lower layer ready"));

  mpuReady = wakeMPU6050();

  if (mpuReady) {
    Serial.println(F("MPU6050 found"));
    calibrateGyroZ();
  } else {
    Serial.println(F("MPU6050 missing"));
  }

  sendFlash(F("ARDUINO_BOOTED"));
}

void loop() {
  readESP32Serial();

  if (robotMode == MODE_LINE || robotMode == MODE_RETURN) {
    followLineStep();
  }

  handleManualTimeout();
}