// Document tile fixtures for the gallery (`04-Documents`).
// thumbnail === null → screen renders a deterministic colored placeholder
// keyed off the document id. Real bitmaps land in a future spec.

export const MOCK_DOCUMENTS = [
  {
    id: 'doc-cyberpunk-cityscape',
    name: 'Cyberpunk cityscape',
    updatedAt: '2026-05-02T14:23:00Z',
    size: [1024, 1024],
    workspace: 'Generate',
    thumbnail: null,
  },
  {
    id: 'doc-portrait-7',
    name: 'Portrait study #7',
    updatedAt: '2026-05-02T11:08:00Z',
    size: [1024, 1024],
    workspace: 'Inpaint',
    thumbnail: null,
  },
  {
    id: 'doc-fantasy-landscape',
    name: 'Fantasy landscape v2',
    updatedAt: '2026-04-29T19:42:00Z',
    size: [1536, 1024],
    workspace: 'Generate',
    thumbnail: null,
  },
  {
    id: 'doc-logo-explorations',
    name: 'Logo explorations',
    updatedAt: '2026-04-29T08:31:00Z',
    size: [512, 512],
    workspace: 'Live',
    thumbnail: null,
  },
  {
    id: 'doc-product-mockup',
    name: 'Product mockup render',
    updatedAt: '2026-04-27T16:50:00Z',
    size: [2048, 1024],
    workspace: 'Upscale',
    thumbnail: null,
  },
  {
    id: 'doc-character-concept',
    name: 'Character concept art',
    updatedAt: '2026-04-26T13:12:00Z',
    size: [1024, 1536],
    workspace: 'Generate',
    thumbnail: null,
  },
  {
    id: 'doc-texture-marble',
    name: 'Texture pack — marble',
    updatedAt: '2026-04-25T22:09:00Z',
    size: [2048, 2048],
    workspace: 'Generate',
    thumbnail: null,
  },
  {
    id: 'doc-arch-viz',
    name: 'Architectural viz',
    updatedAt: '2026-04-21T09:48:00Z',
    size: [1920, 1080],
    workspace: 'Inpaint',
    thumbnail: null,
  },
] as const;
