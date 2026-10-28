/**
 * useDebounce — delays updating the returned value until the input
 * value has not changed for `delay` milliseconds.
 *
 * WHY:
 * Prevents firing a search/filter on every keystroke. Used for search
 * inputs that will (when real API is connected) trigger network requests.
 * 300ms is the standard threshold: imperceptible delay, substantial
 * reduction in request count.
 */

import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
