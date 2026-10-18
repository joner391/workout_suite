/**
 * Workout Suite — Jest mock for react-native core components
 *
 * Enables headless Node.js unit testing of React Native components without
 * native binary bindings or Babel/Flow transpilations.
 */

import React from 'react';

const mockComponent = (name: string) => {
  const Component: React.FC<any> = (props: any) => {
    return React.createElement(name, props, props.children);
  };
  Component.displayName = name;
  return Component;
};

export const View = mockComponent('View');
export const Text = mockComponent('Text');
export const TouchableOpacity = mockComponent('TouchableOpacity');
export const TextInput = mockComponent('TextInput');
export const Modal = mockComponent('Modal');
export const ScrollView = mockComponent('ScrollView');
export const FlatList = mockComponent('FlatList');
export const ActivityIndicator = mockComponent('ActivityIndicator');

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
  flatten: (styles: any) => (Array.isArray(styles) ? Object.assign({}, ...styles) : styles),
};

export const Alert = {
  alert: jest.fn((title, message, buttons) => {
    const confirmBtn = buttons?.find((b: any) => b.text !== 'Cancel');
    if (confirmBtn?.onPress) {
      confirmBtn.onPress();
    }
  }),
};

export const Platform = {
  OS: 'ios' as const,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj.ios !== undefined ? obj.ios : obj.default,
};

export const useWindowDimensions = jest.fn(() => ({
  width: 375,
  height: 812,
  scale: 2,
  fontScale: 1,
}));

export const BackHandler = {
  addEventListener: jest.fn((event, callback) => ({
    remove: jest.fn(),
  })),
  removeEventListener: jest.fn(),
  exitApp: jest.fn(),
};
