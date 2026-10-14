import React from 'react';

const mockComponent = (name: string) => {
  const Component: React.FC<any> = (props: any) => {
    return React.createElement(name, props, props.children);
  };
  Component.displayName = name;
  return Component;
};

export const SafeAreaProvider = mockComponent('SafeAreaProvider');
export const SafeAreaView = mockComponent('SafeAreaView');
export const useSafeAreaInsets = () => ({ top: 0, right: 0, bottom: 0, left: 0 });
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 390, height: 844 });
export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
