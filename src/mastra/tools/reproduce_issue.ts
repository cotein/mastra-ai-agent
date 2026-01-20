

import 'dotenv/config';
import { getAvailableSlots, createCalendarEvent, deleteCalendarEvent } from './google-calendar';


async function run() {
  console.log("--- 1. Fetching initial slots ---");
  const initialSlotsFn = getAvailableSlots.execute as () => Promise<any[]>;
  const initialSlots = await initialSlotsFn();
  
  if (initialSlots.length === 0) {
    console.log("No slots available to test.");
    return;
  }

  const targetSlot = initialSlots[0];
  console.log("Targeting slot:", targetSlot);

  console.log("\n--- 2. Booking the slot ---");
  const createEventFn = createCalendarEvent.execute as (input: any) => Promise<any>;
  const bookingResult = await createEventFn({
    title: "TEST BOOKING - REPRODUCE BUG",
    start: targetSlot.iso, // Using the exact ISO string returned by getAvailableSlots
    clientName: "Test User",
    clientPhone: "123456789",
    propertyAddress: "Test Address"
  });

  if (!bookingResult.success) {
    console.error("Failed to book slot:", bookingResult);
    return;
  }
  const eventId = bookingResult.eventId;
  console.log("Booked event ID:", eventId);

  // Wait a moment for API propagation (though strong consistency is usually fast)
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("\n--- 3. Fetching slots again ---");
  const newSlots = await initialSlotsFn();
  
  const isSlotStillThere = newSlots.some(s => s.iso === targetSlot.iso);
  
  if (isSlotStillThere) {
    console.error("❌ BUG REPRODUCED: The booked slot is STILL in the available list!");
    console.error("Booked ISO:", targetSlot.iso);
    console.error("Available Slots:", newSlots.map(s => s.iso));
  } else {
    console.log("✅ NO BUG: The booked slot was correctly removed.");
  }

  console.log("\n--- 4. Cleanup ---");
  const deleteEventFn = deleteCalendarEvent.execute as (input: any) => Promise<any>;
  await deleteEventFn({ eventId });
  console.log("Cleanup done.");
}

run().catch(console.error);
