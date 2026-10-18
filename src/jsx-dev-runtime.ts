import { jsx } from './jsx-runtime';

/**
 * Re-exports the fragment component and JSX types for development transforms.
 */
export { Fragment, type JSX } from './jsx-runtime';

/**
 * Creates a prompt element for the development JSX transform.
 * @param type - Intrinsic tag name or component function.
 * @param props - Element attributes and children.
 * @returns The element with the supplied type and props.
 */
export const jsxDEV = jsx;
