import { createContext, useContext } from 'react';

/**
 * True when the surrounding screen is the visible tab. Tabs stay mounted for
 * instant switching, so background timers/pollers must gate on this.
 */
export const TabActiveContext = createContext(true);

export const useTabActive = () => useContext(TabActiveContext);
