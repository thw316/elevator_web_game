/**
 * app.js — Elevator Game Logic & Animation Controller
 *
 * State machine: IDLE → CLOSING → MOVING → ARRIVING → OPENING → IDLE
 * Floor numbering: B99(-99) ... B1(-1), 1 ... 999 (no floor 0)
 */

/* ===== Constants ===== */
const State = Object.freeze({
  IDLE:     'idle',
  CLOSING:  'closing',
  MOVING:   'moving',
  ARRIVING: 'arriving',
  OPENING:  'opening',
});

const VISIBLE_FLOORS = 11;
const BUFFER_SLOTS   = 1;       // 1 hidden slot top & bottom
const TOTAL_SLOTS    = VISIBLE_FLOORS + 2 * BUFFER_SLOTS; // 13
const SLOT_HEIGHT    = 46;      // px per floor slot
const CENTER_SLOT    = Math.floor(TOTAL_SLOTS / 2);       // index 6

const MIN_FLOOR = -99;
const MAX_FLOOR = 999;

/* ===== Elevator Game Class ===== */
class ElevatorGame {
  constructor() {
    this.state        = State.IDLE;
    this.currentFloor = 1;
    this.targetFloor  = 1;
    this.audio        = new ElevatorAudio();
    this.shaftTimeout = null;
    this._submitLocked = false;

    // DOM references
    this.floorDisplay = document.getElementById('floor-display');
    this.arrowUp      = document.getElementById('arrow-up');
    this.arrowDown    = document.getElementById('arrow-down');
    this.doorLeft     = document.getElementById('door-left');
    this.doorRight    = document.getElementById('door-right');
    this.floorInput   = document.getElementById('floor-input');
    this.floorForm    = document.getElementById('floor-form');

    this.shaftStrip   = document.getElementById('shaft-strip');

    this._init();
  }

  /* ---------- Initialization ---------- */
  _init() {
    // Build shaft floor slots
    this._generateShaftSlots();
    this._updateShaft(this.currentFloor);
    this._updateFloorDisplay(this.currentFloor);

    // Idle glow
    this.floorDisplay.classList.add('idle-glow');

    // Event listeners — form submit handles both Enter key and GO button click
    if (this.floorForm) {
      this.floorForm.addEventListener('submit', (e) => {
        e.preventDefault();
        if (this._submitLocked) return; // prevent repeated Enter key-repeat
        this._submitLocked = true;
        this._handleGo();
      });
    }

    // Release the submit lock when any key is released (handles held Enter)
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        this._submitLocked = false;
      }
    });

    // Also listen for input sanitization
    this.floorInput.addEventListener('input', () => this._handleInput());

    // Initialize audio on first user gesture
    const initAudio = () => { this.audio.init(); };
    document.addEventListener('click',   initAudio, { once: true });
    document.addEventListener('keydown', initAudio, { once: true });

    // Auto-focus input
    this.floorInput.focus();

    console.log('[ElevatorGame] Initialized successfully. State:', this.state);
  }

  /* ---------- Shaft Setup ---------- */
  _generateShaftSlots() {
    this.shaftStrip.innerHTML = '';
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'shaft-floor';
      slot.addEventListener('click', () => {
        if (this.state !== State.IDLE) return;
        const label = slot.textContent.trim();
        if (label) {
          this.floorInput.value = label;
          this._handleGo();
        }
      });
      this.shaftStrip.appendChild(slot);
    }
    this.shaftStrip.style.transform = `translateY(-${SLOT_HEIGHT}px)`;
  }

  /** Update all shaft slot labels centered on the given floor */
  _updateShaft(centerFloor) {
    const slots = this.shaftStrip.children;
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const offset = CENTER_SLOT - i; // positive = above center
      const floor = this._getFloorAtOffset(centerFloor, offset);
      slots[i].textContent = this._formatFloorLabel(floor);
    }
  }

  /* ---------- Floor Helpers ---------- */

  /**
   * Get the floor number that is `offset` floors away from `center`.
   * Positive offset = above, negative = below. Skips floor 0.
   */
  _getFloorAtOffset(center, offset) {
    if (offset === 0) return center;
    const step = offset > 0 ? 1 : -1;
    let floor = center;
    const count = Math.abs(offset);
    for (let i = 0; i < count; i++) {
      floor += step;
      if (floor === 0) floor += step; // skip floor 0
    }
    return floor;
  }

  /** Format floor number for the shaft labels */
  _formatFloorLabel(n) {
    if (n === 0 || n < MIN_FLOOR || n > MAX_FLOOR) return '';
    if (n < 0) return 'B' + Math.abs(n);
    return '' + n;
  }

  /** Format floor number for the LED display */
  _formatFloorDisplay(n) {
    if (n < 0) return 'B' + Math.abs(n);
    return '' + n;
  }

  /**
   * Parse user input string to an internal floor number.
   * Returns null if invalid.
   */
  _parseFloorInput(value) {
    var v = value.trim().toUpperCase();
    if (!v) return null;

    if (v.charAt(0) === 'B') {
      var numStr = v.substring(1);
      if (!numStr || !/^\d+$/.test(numStr)) return null;
      var num = parseInt(numStr, 10);
      if (num < 1 || num > 99) return null;
      return -num;
    } else {
      if (!/^\d+$/.test(v)) return null;
      var num = parseInt(v, 10);
      if (num < 1 || num > 999) return null;
      return num;
    }
  }

  /* ---------- Input Handling ---------- */

  /** Sanitize input value after any change */
  _handleInput() {
    var cursorPos = this.floorInput.selectionStart;
    var oldValue = this.floorInput.value;

    // Uppercase & remove invalid chars
    var v = oldValue.toUpperCase().replace(/[^0-9B]/g, '');

    // Ensure B only at position 0, max one B
    if (v.indexOf('B') !== -1) {
      if (v.charAt(0) === 'B') {
        // Keep first B, strip any others
        v = 'B' + v.substring(1).replace(/B/g, '');
      } else {
        // B not at start → remove all B
        v = v.replace(/B/g, '');
      }
    }

    if (v !== oldValue) {
      this.floorInput.value = v;
      var newPos = Math.min(cursorPos, v.length);
      this.floorInput.setSelectionRange(newPos, newPos);
    }
  }

  /* ---------- Submit & Validation ---------- */

  _handleGo() {
    if (this.state !== State.IDLE) return;

    // Ensure audio is ready
    this.audio.init();

    var target = this._parseFloorInput(this.floorInput.value);

    if (target === null || target === this.currentFloor) {
      this._showError();
      return;
    }

    this.targetFloor = target;
    // Keep the input value visible during travel — it will be cleared after arrival
    this._startElevator();
  }

  _showError() {
    this.floorInput.classList.add('shake');
    this.audio.playErrorBeep();
    var self = this;
    setTimeout(function() {
      self.floorInput.classList.remove('shake');
    }, 600);
  }

  /* ---------- Elevator Sequence ---------- */

  async _startElevator() {
    this._setInputEnabled(false);
    this.floorDisplay.classList.remove('idle-glow');

    // 1. Close doors
    await this._closeDoors();

    // 2. Move to target floor
    await this._moveToFloor();

    // 3. Speak the arrived floor in English
    this.audio.speakFloor(this.currentFloor);

    // 4. Open doors
    await this._openDoors();

    // 5. Clear input after arrival, re-enable and focus
    this.floorInput.value = '';
    this.floorDisplay.classList.add('idle-glow');
    this._setInputEnabled(true);
    this.floorInput.focus();
  }

  _setInputEnabled(enabled) {
    this.floorInput.disabled = !enabled;
  }

  /* ----- Door Animations ----- */

  _closeDoors() {
    var self = this;
    return new Promise(function(resolve) {
      self.state = State.CLOSING;
      self.audio.playCloseSound();

      self.doorLeft.classList.add('closed');
      self.doorRight.classList.add('closed');

      setTimeout(resolve, 1000);
    });
  }

  _openDoors() {
    var self = this;
    return new Promise(function(resolve) {
      self.state = State.OPENING;
      self.audio.playOpenSound();

      self.doorLeft.classList.remove('closed');
      self.doorRight.classList.remove('closed');

      setTimeout(function() {
        self.state = State.IDLE;
        resolve();
      }, 1000);
    });
  }

  /* ----- Movement ----- */

  async _moveToFloor() {
    this.state = State.MOVING;
    var direction = this.targetFloor > this.currentFloor ? 1 : -1;
    var totalFloors = this._calcTotalFloors(this.currentFloor, this.targetFloor);

    // Activate direction arrow
    if (direction > 0) {
      this.arrowUp.classList.add('active');
    } else {
      this.arrowDown.classList.add('active');
    }

    // Start ambient moving sound
    this.audio.startMovingSound();

    // Traverse floor by floor
    for (var i = 0; i < totalFloors; i++) {
      var duration = this._getFloorDuration(i, totalFloors);
      await this._moveOneFloor(direction, duration);
    }

    // Stop sounds & arrows
    this.audio.stopMovingSound();
    this.arrowUp.classList.remove('active');
    this.arrowDown.classList.remove('active');

    // Arrival
    this.state = State.ARRIVING;
    this.audio.playArrivalDing();
    await this._delay(600);
  }

  /** Calculate number of floor transitions between two floors (skipping 0) */
  _calcTotalFloors(from, to) {
    var raw = Math.abs(to - from);
    var crossesZero = (from < 0 && to > 0) || (from > 0 && to < 0);
    return crossesZero ? raw - 1 : raw;
  }

  /** Advance by one floor and animate */
  _moveOneFloor(direction, duration) {
    var self = this;
    return new Promise(function(resolve) {
      // Animate shaft scroll BEFORE updating currentFloor
      self._animateShaftScroll(direction, duration);

      // Calculate new floor
      var newFloor = self.currentFloor + direction;
      if (newFloor === 0) newFloor += direction; // skip floor 0
      self.currentFloor = newFloor;

      // Update LED display
      self._updateFloorDisplay(self.currentFloor);

      setTimeout(resolve, duration);
    });
  }

  /* ----- Shaft Scroll Animation ----- */

  /**
   * Smoothly scroll the shaft strip by one floor.
   * The strip has 13 slots (11 visible + 2 buffer).
   * Default translateY = -46px (hiding slot 0 above viewport).
   */
  _animateShaftScroll(direction, floorDuration) {
    if (this.shaftTimeout) {
      clearTimeout(this.shaftTimeout);
      this.shaftTimeout = null;
    }

    var scrollDuration = Math.min(Math.floor(floorDuration * 0.75), 700);

    // For very fast movement, skip animation and just update
    if (floorDuration < 80) {
      this.shaftStrip.style.transition = 'none';
      var self = this;
      queueMicrotask(function() {
        self._updateShaft(self.currentFloor);
        self.shaftStrip.style.transform = 'translateY(-' + SLOT_HEIGHT + 'px)';
      });
      return;
    }

    // Step 1: Ensure strip is in the "before" state
    this.shaftStrip.style.transition = 'none';
    this._updateShaft(this.currentFloor);
    this.shaftStrip.style.transform = 'translateY(-' + SLOT_HEIGHT + 'px)';
    void this.shaftStrip.offsetHeight; // force reflow

    // Step 2: Pre-populate the buffer slot that will become visible
    var slots = this.shaftStrip.children;
    if (direction > 0) {
      var newCenter = this._nextFloor(this.currentFloor, direction);
      var newTopFloor = this._getFloorAtOffset(newCenter, CENTER_SLOT);
      slots[0].textContent = this._formatFloorLabel(newTopFloor);
    } else {
      var newCenter = this._nextFloor(this.currentFloor, direction);
      var newBottomFloor = this._getFloorAtOffset(newCenter, -CENTER_SLOT);
      slots[TOTAL_SLOTS - 1].textContent = this._formatFloorLabel(newBottomFloor);
    }

    // Step 3: Animate
    this.shaftStrip.style.transition = 'transform ' + scrollDuration + 'ms ease-out';
    if (direction > 0) {
      this.shaftStrip.style.transform = 'translateY(0)';
    } else {
      this.shaftStrip.style.transform = 'translateY(-' + (2 * SLOT_HEIGHT) + 'px)';
    }

    // Step 4: After animation, reset
    var self = this;
    this.shaftTimeout = setTimeout(function() {
      self.shaftStrip.style.transition = 'none';
      self._updateShaft(self.currentFloor);
      self.shaftStrip.style.transform = 'translateY(-' + SLOT_HEIGHT + 'px)';
      void self.shaftStrip.offsetHeight;
      self.shaftTimeout = null;
    }, scrollDuration + 30);
  }

  /** Get the next floor in the given direction, skipping 0 */
  _nextFloor(floor, direction) {
    var next = floor + direction;
    if (next === 0) next += direction;
    return next;
  }

  /* ----- Movement Timing ----- */

  /**
   * Calculate how long each floor transition should take (ms).
   *
   * Short trips (≤10 floors): 2000ms per floor
   * Long trips (>10 floors):
   *   - First 3: accelerate (2000 → 1500 → 1000 ms)
   *   - Middle:  cruise (proportional, min 50ms, max 300ms)
   *   - Last 3:  decelerate (1000 → 1500 → 2000 ms)
   */
  _getFloorDuration(index, totalFloors) {
    if (totalFloors <= 10) return 2000;

    var ACCEL = 3;
    var DECEL_START = totalFloors - 3;

    // Acceleration phase
    if (index < ACCEL) {
      return [2000, 1500, 1000][index];
    }

    // Deceleration phase
    if (index >= DECEL_START) {
      return [1000, 1500, 2000][index - DECEL_START];
    }

    // Cruise phase
    var middleFloors = totalFloors - 6;
    var targetCruiseTime = 21000; // 21 seconds budget for cruise
    return Math.max(50, Math.min(300, Math.floor(targetCruiseTime / middleFloors)));
  }

  /* ----- Display Update ----- */

  _updateFloorDisplay(floor) {
    this.floorDisplay.textContent = this._formatFloorDisplay(floor);

    // Pop animation
    this.floorDisplay.classList.remove('number-pop');
    void this.floorDisplay.offsetHeight; // reset animation
    this.floorDisplay.classList.add('number-pop');
  }

  /* ----- Utility ----- */
  _delay(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  }
}

/* ===== Bootstrap ===== */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    window.elevatorGame = new ElevatorGame();
  });
} else {
  window.elevatorGame = new ElevatorGame();
}
