type HorizontalBase = 'left' | 'center' | 'right';
type VerticalBase = 'top' | 'center' | 'bottom';

interface PositionSettings {
    includeSelfRotationAndScale?: boolean;
    ignoreScale?: boolean;
    ignoreRotation?: boolean;
    horizontalBase?: HorizontalBase;
    verticalBase?: VerticalBase;
}

/**
 * Global settings to apply as a default to all animations. Can be overriden in each animation.
 */
interface AnimationManagerSettings {
    /**
     * The default animation duration, in ms (default: 500).
     */
    duration?: number;

    /**
     * The CSS easing function, default 'ease-in-out'.
     */
    easing?: string;

    /**
     * Determines the behavior of the placeholder at the starting position ("from") of the animation.
     * Default: 'shrinking'.
     * 
     * Options:
     * - 'on': Keeps the placeholder occupying the full element's space until the animation completes.
     * - 'off': Does not add a placeholder.
     * - 'shrink': Gradually reduces the placeholder's size until it disappears.
     */
    fromPlaceholder?: 'on' | 'shrink' | 'off';

    /**
     * Determines the behavior of the placeholder at the ending position ("to") of the animation.
     * Default: 'growing'.
     * 
     * Options:
     * - 'on': Keeps the placeholder occupying the full element's space until the animation completes.
     * - 'off': Does not add a placeholder.
     * - 'grow': Gradually increases the placeholder's size until it fully appears.
     */
    toPlaceholder?: 'on' | 'grow' | 'off';

    /**
     * A function returning a boolean, or a boolean, to know if animations are active.
     */
    animationsActive?: (() => boolean) | boolean;
}

/**
 * Extra animation to apply to another element while main animation is played. Will have the same duration.
 */
interface ParallelAnimation {
    /**
     * Element to apply the animation to. If not set, will use `applyTo`.
     */
    applyToElement?: HTMLElement;

    /**
     * Element to apply the animation to, if `applyToElement` is not set. Default to 'intermediate'.
     * 'wrapper': will apply the animation directly on the wrapper.
     * 'intermediate': will apply the animation on a new wrapper inserted between the main wrapper and the element.
     * 'element': will apply the animation directly on the animated element.
     */
    applyTo?: 'wrapper' | 'intermediate' | 'element';

    /**
     * Keyframes of the animation.
     */
    keyframes: Keyframe[];
}

/**
 * Settings to apply to an animation. Other animations can be run in parallel, using the same duration.
 */
interface AnimationSettings extends AnimationManagerSettings {
    /**
     * Animations to play at the same time as the main animation
     */
    parallelAnimations?: ParallelAnimation[];

    /**
     * Preserve the scale of the object when sliding in or out.
     */
    preserveScale?: boolean;
}

interface SlideAnimationSettings extends AnimationSettings {
    /**
     * The scale bump to use in the middle of a slide animation, to fake an item grabbed from one place to the other. Default 1.2
     */
    bump?: number;
}

interface SequenceAnimationsSettings extends AnimationSettings {
    /**
     * A pause between the animations, in ms (default undefined/0).
     * If set in an inner animation settings, will apply after the animation, except if the animation is the last one.
     */
    innerPause?: number;
}

interface FloatingElementAnimationSettings extends SlideAnimationSettings {
    fromSettings?: PositionSettings;
    toSettings?: PositionSettings;

    /**
     * Ignore the scale of the from and to element when doing the animation (default true).
     */
    ignoreScale?: boolean;

    /**
     * Ignore the rotation of the from and to element when doing the animation (default true).
     */
    ignoreRotation?: boolean;

    /**
     * A scale to apply to the floating element.
     */
    scale?: number;
}

interface DisplayElementAnimationSettings extends FloatingElementAnimationSettings {
    /**
     * If the display animation has a default animation, indicates if it should be played (default true).
     */
    defaultAnimation?: boolean;

    /**
     * Extra class to add to add to the animated element.
     */
    extraClass?: string;

    /**
     * Extra classes to add to add to the animated element.
     */
    extraClasses?: string[];
}

interface AnimationResult {
    animation: Animation;
    element?: HTMLElement;
    animationWrapper?: HTMLElement;
}

interface SurfaceAnimationResult extends AnimationResult {
    toMatrix: DOMMatrixReadOnly | null;
}

/**
 * Give all necessary informations about a running animation.
 */
interface RunningAnimation {
    /**
     * The animated element.
     */
    element?: HTMLElement;

    /**
     * The wrapper around the element during the animation
     */
    wrapper?: HTMLElement;

    /**
     * The original element parent.
     */
    fromParent?: HTMLElement;

    /**
     * The original element next sibling (null if it was the last child).
     */
    fromNextSibling?: HTMLElement;

    /**
     * The destination of the element.
     */
    toParent?: HTMLElement;

    /**
     * The destination next sibling (null if it will be the last child).
     */
    toNextSibling?: HTMLElement;

    /**
     * The computed matrix of the original position.
     */
    fromMatrix: DOMMatrixReadOnly | null;

    /**
     * The computed matrix of the destination position.
     */
    toMatrix: DOMMatrixReadOnly | null;

    /**
     * The temporary wrapper added to the destination during the animation.
     */
    toSpaceWrapper?: HTMLElement;

    /**
     * The temporary wrappers to remove at the end of the animation.
     */
    wrappersToRemove?: HTMLElement[];
}

/**
 * Base functions to help create animations.
 */
declare class BaseAnimationManager {
    /**
     * The surface on which the animations will run. Attached directly to the body.
     */
    private animationSurface;
    /**
     * Indicates if getBoundingClientRect is taking the zoom property into account.
     */
    private zoomAware;
    private growingPlaceholderAnimations;
    private handleGrowPlaceholderAnimationCumulation;
    constructor();
    /**
     * Create the animation surface, an unselectable div starting at the top of the screen where the animated element will be attached.
     */
    private createAnimationSurface;
    /**
     * Get rotation & scale matrix for an element, relative to the parent.
     */
    private getRotationAndScaleMatrixForElement;
    /**
     * Get rotation & scale matrix for an element, relative to the top of the page.
     */
    getRotationAndScaleMatrix(element: HTMLElement, includeSelf?: boolean): DOMMatrix;
    /**
     * Get translation, rotation & scale matrix for an element, relative to the top of the page.
     */
    getFullMatrix(element: HTMLElement, params?: PositionSettings): DOMMatrixReadOnly;
    /**
     * Remove the scale part of a matrix.
     */
    removeScaleFromMatrix(matrix: DOMMatrix): DOMMatrix;
    /**
     * Remove the rotation part of a matrix.
     */
    removeRotationFromMatrix(matrix: DOMMatrix): DOMMatrix;
    /**
     * Remove the translation part of a matrix.
     */
    removeTranslationFromMatrix(matrix: DOMMatrix): DOMMatrix;
    /**
     * Create a temp div of the same size as the element.
     */
    createPlaceholder(elem: HTMLElement): HTMLElement;
    /**
     * Make an empty space grow or shrink to replace where a moved object was or will be.
     * Ignore the animation settings, prefer addAnimatedSpaceIfNecessary.
     */
    addFixedSpace(element: HTMLElement, parent: HTMLElement, insertBefore?: Element): HTMLElement;
    /**
     * Make an empty space grow or shrink to replace where a moved object was or will be.
     * Ignore the animation settings, prefer addAnimatedSpaceIfNecessary.
     */
    addAnimatedSpace(element: HTMLElement, parent: HTMLElement, type: 'grow' | 'shrink' | 'on', animationSettings: AnimationSettings, insertBefore?: Element): Promise<AnimationResult>;
    /**
     * Make an empty space grow or shrink to replace where a moved object was or will be.
     * Only if the animation settings says so.
     */
    addAnimatedSpaceIfNecessary(element: HTMLElement, parent: HTMLElement, type: 'from' | 'to', animationSettings: AnimationSettings, insertBefore?: Element): Promise<AnimationResult>;
    /**
     * Returns the average of 2 matrixes.
     */
    private averageDOMMatrix;
    /**
     * Apply the given scale to a matrix.
     */
    private applyMatrixScale;
    /**
     * Add a wrapper around an element, and add the elment on that wrapper.
     * Needed before doing animations on the surface
     */
    wrapOnAnimationSurface(element: HTMLElement, positionSettings?: PositionSettings): HTMLElement;
    /**
     * Add a wrapper layer.
     * Needed before doing sub-animations without messing to the animation on the main wrapper
     */
    addWrapperLayer(baseWrapper: HTMLElement): HTMLElement;
    /**
     * Find the animated element in a possibly multi-layer wrapper.
     */
    private getElementInWrapper;
    /**
     * Creates a bump animation, that simulates a physical item being lifted from one place to another.
     */
    createBumpAnimation(bump: number | null | undefined): ParallelAnimation | null;
    /**
     * Creates a fade animation, 'in' for appearing and 'out' for disappearing.
     */
    createFadeAnimation(type: 'in' | 'out'): ParallelAnimation;
    /**
     * Animate an object on the animation surface, from a matrix to a matrix.
     */
    animateOnAnimationSurface(animationWrapper: HTMLElement, fromMatrix: DOMMatrixReadOnly, toMatrix: DOMMatrixReadOnly, animationSettings: AnimationSettings): Promise<SurfaceAnimationResult>;
    /**
     * Attach an element to a new parent.
     */
    attachToElement(element: HTMLElement, toElement: HTMLElement, insertBefore?: Element): void;
    /**
     * Prepare a slide in animation. Wraps the object to the animation surface and return a RunningAnimation.
     */
    startSlideInAnimation(element: HTMLElement, fromElement?: HTMLElement, fromIgnoreScale?: boolean, fromIgnoreRotation?: boolean, preserveScale?: boolean): RunningAnimation | null;
    /**
     * Prepare a slide out animation. Wraps the object to the animation surface and return a RunningAnimation.
     */
    startSlideOutAnimation(element: HTMLElement, toElement?: HTMLElement, fromIgnoreScale?: boolean, fromIgnoreRotation?: boolean, preserveScale?: boolean): RunningAnimation | null;
    /**
     * Prepare an attach animation. Wraps the object to the animation surface and return a RunningAnimation.
     */
    startAttachAnimation(element: HTMLElement, toElement: HTMLElement, insertBefore?: HTMLElement, fromPlaceholder?: HTMLElement, toPlaceholder?: HTMLElement): RunningAnimation | null;
    /**
     * Pause the growing placeholder animations and consider they are at full duration (taking final space).
     * Allow to get the real position of the moved element including the shift from animations started just before this one.
     */
    protected pausePlaceholderGrowAnimations(): void;
    /**
     * Restore the growing placeholder animations to before the pause.
     */
    protected restorePlaceholderGrowAnimations(): void;
    /**
     * End a RunningAnimation, by attaching the element to its final destination and cleaning the temporary elements.
     */
    endRunningAnimation(runningAnimation: RunningAnimation): void;
    /**
     * Remove an element from the DOM.
     */
    removeElement(element: HTMLElement | undefined | null): void;
    /**
     * Return a Promise that resolves at the end of a given number of ms.
     *
     * @param {number} delay the time to wait, in milliseconds
     * @returns a promise when the timer ends
     */
    wait(delay: number): Promise<void>;
    /**
     * returns the getBoundingClientRect of an element with zoom awareness, independant to browser native handling of CSS zoom property.
     */
    getBoundingClientRect(element: HTMLElement): DOMRect | {
        x: number;
        y: number;
        top: number;
        left: number;
        bottom: number;
        right: number;
        width: number;
        height: number;
    };
}

/**
 * The animation class, giving access to many type of animations, and the possibility to run multiple animation with a delta or sync/async.
 * Instanciate only one for all your game animations.
 */
declare class AnimationManager {
    base: BaseAnimationManager;
    private animationSettings;
    /**
     * @param animationSettings: the default settings for your animations. It's very recommended to set it to `{ animationsActive: () => this.bgaAnimationsActive(), }`.
     */
    constructor(animationSettings?: AnimationManagerSettings);
    /**
     * Indicates if animations should be run, based on constructor `animationSettings`.
     */
    animationsActive(): boolean;
    /**
     * Slide an object to an element.
     */
    slideAndAttach(element: HTMLElement, toElement: HTMLElement, animationSettings?: SlideAnimationSettings, insertBefore?: HTMLElement): Promise<any>;
    /**
     * Swap two elements.
     */
    swap(elements: HTMLElement[], animationSettings?: SlideAnimationSettings): Promise<any>;
    /**
     * Play a list of animations then attach to an element.
     */
    sequenceAnimationsAttach(element: HTMLElement, toElement: HTMLElement, animations: ((runningAnimation: RunningAnimation, animationSettings?: AnimationSettings) => Promise<RunningAnimation>)[], animationSettings?: SequenceAnimationsSettings | SequenceAnimationsSettings[], insertBefore?: HTMLElement): Promise<any>;
    /**
     * Slide an object to the screen center then an element.
     */
    slideToScreenCenterAndAttach(element: HTMLElement, toElement: HTMLElement, animationSettings?: SequenceAnimationsSettings | SequenceAnimationsSettings[], insertBefore?: HTMLElement): Promise<any>;
    /**
     * Slide an object over an intermediate element then attach to an element.
     */
    slideToElementAndAttach(element: HTMLElement, overElement: HTMLElement, toElement: HTMLElement, animationSettings?: SequenceAnimationsSettings | SequenceAnimationsSettings[], insertBefore?: HTMLElement): Promise<any>;
    /**
     * Slide an object in. The object must be attached to the destination before.
     */
    slideIn(element: HTMLElement, fromElement?: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Slide an object in. The object must be attached to the destination before.
     */
    slideInFromDelta(element: HTMLElement, fromDelta: {
        x: number;
        y: number;
    }, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Fade an object in. The object must be attached to the destination before.
     */
    fadeIn(element: HTMLElement, fromElement?: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * slide out an object and destroy it. It call be called with a toElement, in that case a slide animation will be triggered.
     */
    slideOutAndDestroy(element: HTMLElement, toElement?: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Fade out an object and destroy it. It call be called with a toElement, in that case a slide animation will be triggered.
     */
    fadeOutAndDestroy(element: HTMLElement, toElement?: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Returns a completed and valid `DisplayElementAnimationSettings` with default values set.
     */
    protected getFloatingElementParams(animationSettings?: DisplayElementAnimationSettings, defaultAnimation?: ParallelAnimation): DisplayElementAnimationSettings;
    /**
     * Add a floating element over another element.
     */
    slideFloatingElement(element: HTMLElement, fromElement: HTMLElement | null | undefined, toElement: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Add a floating element over another element.
     */
    addFloatingElement(element: HTMLElement, toElement: HTMLElement, animationSettings?: FloatingElementAnimationSettings): Promise<any>;
    /**
     * Apply the `DisplayElementAnimationSettings` to the displayElement.
     */
    protected addDisplayElementAnimationSettings(element: HTMLElement, animationSettings?: DisplayElementAnimationSettings): void;
    /**
     * Add a floating message over another element.
     */
    displayMessage(toElement: HTMLElement, message: string, color: string, animationSettings?: DisplayElementAnimationSettings): Promise<void>;
    /**
     * Add a floating number over another element.
     * It will be prefixed by '+' if positive, and '-' if negative.
     */
    displayScoring(toElement: HTMLElement, score: number, color: string, animationSettings?: DisplayElementAnimationSettings): Promise<void>;
    /**
     * Add a floating text speach bubble over another element.
     */
    displayBubble(toElement: HTMLElement, message: string, animationSettings?: DisplayElementAnimationSettings): Promise<void>;
    /**
     * Play multiple animations a the same time.
     *
     * @param animations functions generating an animation, returning a Promise.
     * @returns promise when all animations ends
     */
    playParallel(animations: ((index: number) => Promise<any>)[]): Promise<any>;
    /**
     * Play multiple animations one after the other.
     *
     * @param animations functions generating an animation, returning a Promise.
     * @returns promise when all animations ends
     */
    playSequentially(animations: (() => Promise<any>)[]): Promise<any>;
    /**
     * Play multiple animations with a fixed interval between each animation.
     *
     * @param animations functions generating an animation, returning a Promise.
     * @returns promise when all animations ends
     */
    playInterval(animations: ((index: number) => Promise<any>)[], interval?: number): Promise<void>;
}

declare const BgaAnimations: {
    Manager: typeof AnimationManager;
};

export { BgaAnimations, AnimationManager as Manager };
