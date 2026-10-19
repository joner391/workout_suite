/**
 * Workout Suite / datSet — Navigation Context & Lightweight Stack Navigator
 *
 * Implements Item 7: Lightweight stack navigator with Android hardware back-button
 * handling, deep sub-screen routing, and modal elimination without external native dependencies.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { BackHandler } from 'react-native';

export type RootTab = 'home' | 'workout' | 'profile' | 'settings';

export type SubScreen =
  | 'calendar'
  | 'analytics'
  | 'import'
  | 'exercise_library'
  | 'program_overview'
  | 'gear_inventory'
  | 'body_metrics'
  | 'exercise_detail';

export interface RouteEntry {
  tab: RootTab;
  subScreen: SubScreen | null;
  params?: Record<string, any>;
}

export interface NavigationContextType {
  currentTab: RootTab;
  activeSubScreen: SubScreen | null;
  subScreenParams?: Record<string, any>;
  navigate: (subScreen: SubScreen, params?: Record<string, any>) => void;
  goBack: () => boolean;
  switchTab: (tab: RootTab) => void;
}

export const NavigationContext = createContext<NavigationContextType | null>(null);

export interface NavigationProviderProps {
  initialTab?: RootTab;
  children: ReactNode;
  onTabChange?: (tab: RootTab) => void;
}

export const NavigationProvider: React.FC<NavigationProviderProps> = ({
  initialTab = 'home',
  children,
  onTabChange,
}) => {
  const [navStack, setNavStack] = useState<RouteEntry[]>([
    {
      tab: initialTab,
      subScreen: null,
    },
  ]);

  const currentRoute = navStack[navStack.length - 1] || { tab: 'home', subScreen: null };

  const switchTab = useCallback((newTab: RootTab) => {
    setNavStack((prev) => {
      const top = prev[prev.length - 1];
      if (top && top.tab === newTab && top.subScreen === null) return prev;
      return [...prev, { tab: newTab, subScreen: null }];
    });
    if (onTabChange) onTabChange(newTab);
  }, [onTabChange]);

  const navigate = useCallback((subScreen: SubScreen, params?: Record<string, any>) => {
    setNavStack((prev) => {
      const currentTab = prev[prev.length - 1]?.tab || 'home';
      return [...prev, { tab: currentTab, subScreen, params }];
    });
  }, []);

  const goBack = useCallback((): boolean => {
    if (navStack.length > 1) {
      setNavStack((prev) => prev.slice(0, prev.length - 1));
      return true;
    }
    if (currentRoute.tab !== 'home') {
      switchTab('home');
      return true;
    }
    return false;
  }, [navStack.length, currentRoute.tab, switchTab]);

  // Android hardware back button handler
  useEffect(() => {
    const handleBack = () => {
      return goBack();
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', handleBack);
    return () => sub.remove();
  }, [goBack]);

  const value: NavigationContextType = {
    currentTab: currentRoute.tab,
    activeSubScreen: currentRoute.subScreen,
    subScreenParams: currentRoute.params,
    navigate,
    goBack,
    switchTab,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};

export const useOptionalNavigation = (): NavigationContextType | null => {
  return useContext(NavigationContext);
};
