import { myProvider } from '@/lib/ai/providers';
import { createDocumentHandler } from '@/lib/artifacts/server';
import { experimental_generateImage } from 'ai';

export const imageDocumentHandler = createDocumentHandler<'image'> ({
  kind: 'image',
  // Add userId to destructuring to match CreateDocumentCallbackProps
  onCreateDocument: async ({ title, dataStream, userId }) => {
    let draftContent = '';

    const { image } = await experimental_generateImage({
      model: myProvider.imageModel('small-model'),
      prompt: title,
      n: 1,
    });

    draftContent = image.base64;

    dataStream.writeData({
      type: 'image-delta',
      content: image.base64,
    });

    return draftContent;
  },
  // Add userId to destructuring to match UpdateDocumentCallbackProps
  // Note: onUpdateDocument for image currently uses 'description' but UpdateDocumentCallbackProps provides 'document' and 'description'.
  // We'll add userId, but this function might need review later if 'document' is needed.
  onUpdateDocument: async ({ description, dataStream, userId }) => {
    let draftContent = '';

    const { image } = await experimental_generateImage({
      model: myProvider.imageModel('small-model'),
      prompt: description,
      n: 1,
    });

    draftContent = image.base64;

    dataStream.writeData({
      type: 'image-delta',
      content: image.base64,
    });

    return draftContent;
  },
});
