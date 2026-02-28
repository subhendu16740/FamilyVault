import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface DrawerContextType {
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const DrawerContext = createContext<DrawerContextType>({
  isDrawerOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setIsDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);

  return (
    <DrawerContext.Provider value={{ isDrawerOpen, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  );
}

export const useDrawer = () => useContext(DrawerContext);
