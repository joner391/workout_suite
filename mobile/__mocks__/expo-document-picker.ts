/**
 * Jest mock for expo-document-picker
 */

export const getDocumentAsync = jest.fn(async () => {
  return Promise.resolve({
    canceled: false,
    assets: [
      {
        name: 'test_export.csv',
        uri: 'file:///test_export.csv',
        size: 1024,
        mimeType: 'text/csv',
      },
    ],
  });
});
