<head>
    <title>LyricType</title>
</head>

<script>
    import { onMount } from 'svelte';
    import app from '$lib/services/initFirebase';
    import AppWindow from '$lib/components/AppWindow.svelte';
    import TypingTest from '../lib/components/TypingTest.svelte';
    import Background from '../lib/components/Background.svelte';
    import DesktopIcon from '../lib/components/DesktopIcon.svelte';
    import AboutDisplay from '../lib/components/AboutDisplay.svelte';
    import SettingsDisplay from '../lib/components/SettingsDisplay.svelte';
    import { themeColors, backgroundColors, windowStore, windowActions } from '$lib/services/store.js';


    onMount(async () => {
        if (typeof window !== 'undefined') {
            const { getAnalytics, isSupported } = await import('firebase/analytics');
            isSupported().then((supported) => {
                if (supported) {
                    getAnalytics(app);
                    console.log("Analytics is supported");
                } else {
                    console.log("Analytics is not supported");
                }
            });
        }
    });

    let innerWidth;
    let innerHeight;

    $: if (innerWidth && innerHeight) {
        windowActions.updateScreenDimensions(innerWidth, innerHeight);
    }

    let windows = [
        { 
            id: 'typingTestWindow', 
            title: 'Media Typer', 
            isOpen: false, 
            showScrollbar: true, 
            component: TypingTest, 
            position: { x: 10, y: 15 }
        },
        { 
            id: 'aboutDisplayWindow', 
            title: 'System Info', 
            isOpen: false, 
            showScrollbar: false, 
            component: AboutDisplay, 
            position: { x: 30, y: 10 }, 
            dimensions: {width: 37, height: 85} 
        },
        { 
            id: 'settingsWindow', 
            title: 'Settings', 
            showScrollbar: false, 
            isOpen: false, 
            component: SettingsDisplay, 
            position: { x: 10, y: 10 }, 
            dimensions: {width: 37, height: 78} 
        }
    ];

    onMount(() => {
        if (typeof window !== 'undefined') {
            const updateDimensions = () => {
                windowActions.updateScreenDimensions(
                    window.innerWidth,
                    window.innerHeight
                );
            };

            updateDimensions();
            window.addEventListener('resize', updateDimensions);

            return () => {
                window.removeEventListener('resize', updateDimensions);
            };
        }
    });

    function closeWindow(id) {
        if (!id) return;
        
        const index = windows.findIndex(w => w.id === id);
        if (index !== -1) {
            windows[index].isOpen = false;
            windows = windows.slice(); // Trigger reactivity
            windowActions.removeWindow(id);
        }
    }

    function openWindow(id) {
        if (!id) return;
        
        const window = windows.find(w => w.id === id);
        if (window && !window.isOpen) {
            window.isOpen = true;
            windows = windows.slice();
            windowActions.addWindow({
                id: window.id,
                title: window.title,
                position: window.position,
                dimensions: window.dimensions
            });
        } else if (window) {
            windowActions.activateWindow(id);
        }
    }
</script>


<svelte:window
    bind:innerWidth
    bind:innerHeight
/>

<div 
style:--primary-color={$themeColors.primary}
style:--secondary-color={$themeColors.secondary}
style:--background-primary-color={$backgroundColors.primary}
style:--background-secondary-color={$backgroundColors.secondary}
>
<Background></Background>
<DesktopIcon label="Media Typer" onClick={() => openWindow('typingTestWindow')} position={ {x: 90.5, y: 8} }>
    <svg slot="icon" viewBox="-4 0 45 46" fill="none" xmlns="http://www.w3.org/2000/svg"> <rect x="1" y="0.5" width="35" height="39" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/> <rect x="5" y="4.5" width="27" height="20" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/> <rect x="3" y="39.5" width="31" height="6" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/> <line x1="18.5" y1="31.5" x2="30.5" y2="31.5" stroke="{$themeColors.primary}"/> <path fill-rule="evenodd" clip-rule="evenodd" d="M7.5 7H8.5V8H7.5V7ZM7.5 10H8.5V11H7.5V10ZM8.5 13H7.5V14H8.5V13ZM7.5 16H8.5V17H7.5V16ZM8.5 19H7.5V20H8.5V19ZM10.5 7H11.5V8H10.5V7ZM11.5 10H10.5V11H11.5V10ZM10.5 13H11.5V14H10.5V13ZM11.5 16H10.5V17H11.5V16ZM10.5 19H11.5V20H10.5V19ZM14.5 7H13.5V8H14.5V7ZM13.5 10H14.5V11H13.5V10ZM14.5 19H13.5V20H14.5V19ZM16.5 7H17.5V8H16.5V7ZM17.5 10H16.5V11H17.5V10ZM19.5 7H20.5V8H19.5V7ZM23.5 7H22.5V8H23.5V7Z" fill="{$themeColors.primary}"/>
</DesktopIcon>
<DesktopIcon label="System Info" onClick={() => openWindow('aboutDisplayWindow')} position={ {x: 90.5, y: 28} }>
    <svg slot="icon" viewBox="0 0 54 56" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#filter0_d_116_279)"><path d="M26.4524 1L5.5 23.2581L27.8492 47L48.8016 24.7419L26.4524 1Z" fill="{$themeColors.secondary}"/><path d="M26.4524 1L5.5 23.2581L27.8492 47L48.8016 24.7419L26.4524 1Z" stroke="{$themeColors.primary}"/></g><path d="M38.3254 21.7742L45.3095 29.1935V38.0968H42.5158V36.6129H32.0397L30.6428 35.129H29.246L25.0555 30.6774V29.1935L26.4524 27.7097V26.2258L30.6428 21.7742H38.3254Z" fill="{$themeColors.secondary}"/><path d="M26.4524 27.7097V26.2258L30.6428 21.7742H38.3254L45.3095 29.1935V38.0968H42.5158V36.6129H32.0397L30.6428 35.129H29.246L25.0555 30.6774V29.1935M26.4524 27.7097H29.246M26.4524 27.7097L25.0555 29.1935M29.246 27.7097L30.6428 26.2258H32.0397L33.4365 27.7097V29.1935M29.246 27.7097V29.1935L30.6428 30.6774H32.0397L33.4365 29.1935M33.4365 29.1935H39.7222M25.0555 29.1935H20.8651" stroke="{$themeColors.primary}"/><rect x="45.3095" y="28.4516" width="4.19048" height="11.871" fill="{$themeColors.primary}"/><rect x="29.246" y="28.4516" width="4.19048" height="1.48387" fill="{$themeColors.primary}"/><defs><filter id="filter0_d_116_279" x="0.813293" y="0.270531" width="52.675" height="55.4589" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset dy="4"/><feGaussianBlur stdDeviation="2"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_116_279"/><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_116_279" result="shape"/></filter></defs></svg>
</DesktopIcon>
<DesktopIcon label="Settings" onClick={() => openWindow('settingsWindow')} position={ {x: 91, y: 48} }>
    <svg slot="icon" viewBox="-1 0 49 47" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 46.3475H44C45.1046 46.3475 46 45.4521 46 44.3475V8.23414C46 7.77527 45.8422 7.33034 45.5531 6.97401L41.3062 1.73986C40.9264 1.27182 40.3559 1 39.7531 1H3C1.89543 1 1 1.89543 1 3V44.3475C1 45.4521 1.89543 46.3475 3 46.3475Z" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/><path d="M7.0882 47V29.7518C7.0882 28.6472 7.98363 27.7518 9.0882 27.7518H38.4411C39.5457 27.7518 40.4411 28.6472 40.4411 29.7518V47" stroke="{$themeColors.primary}"/><path d="M34.6176 1L34.6176 14.0071C34.6176 15.1117 33.7222 16.0071 32.6176 16.0071L13.3235 16.0071C12.2189 16.0071 11.3235 15.1117 11.3235 14.0071L11.3235 1.00001" stroke="{$themeColors.primary}"/><rect x="24" y="4.10992" width="5.88235" height="8.78723" rx="1.5" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/></svg>
</DesktopIcon>
<DesktopIcon label="Trash" position={ {x: 91, y: 68} }>
    <svg slot="icon" viewBox="-6 0 44 46" fill="none" xmlns="http://www.w3.org/2000/svg">    <rect x="12.5" y="0.5" width="8" height="1.93617" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>    <rect x="0.5" y="2.45744" width="31" height="2.91489" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>    <path d="M1.5 5.39362H30.5V44C30.5 44.8284 29.8284 45.5 29 45.5H3C2.17157 45.5 1.5 44.8284 1.5 44V5.39362Z" fill="{$themeColors.secondary}" stroke="{$themeColors.primary}"/>    <path d="M6 9.78723L6.89893 10.667C7.28334 11.0433 7.5 11.5585 7.5 12.0964V39.0445C7.5 39.7203 7.1588 40.3503 6.5929 40.7195L6 41.1064" stroke="{$themeColors.primary}"/>    <path d="M12 9.78723L12.8989 10.667C13.2833 11.0433 13.5 11.5585 13.5 12.0964V39.0445C13.5 39.7203 13.1588 40.3503 12.5929 40.7195L12 41.1064" stroke="{$themeColors.primary}"/>    <path d="M18 9.78723L18.8989 10.667C19.2833 11.0433 19.5 11.5585 19.5 12.0964V39.0445C19.5 39.7203 19.1588 40.3503 18.5929 40.7195L18 41.1064" stroke="{$themeColors.primary}"/>    <path d="M24 9.78723L24.8989 10.667C25.2833 11.0433 25.5 11.5585 25.5 12.0964V39.0445C25.5 39.7203 25.1588 40.3503 24.5929 40.7195L24 41.1064" stroke="{$themeColors.primary}"/></svg>    
</DesktopIcon>
{#each windows.filter(w => w.isOpen) as window (window.id)}
    <AppWindow 
        id={window.id}
        title={window.title}
        showScrollbar={window.showScrollbar}
        lyricsMode={window.id === 'typingTestWindow'}
        position={window.position}
        dimensions={$windowStore.windowStates.find(w => w.id === window.id)?.dimensions}
        onClose={() => closeWindow(window.id)}
    >
        <svelte:component 
            this={window.component} 
            id={window.id}
        />
    </AppWindow>
{/each}
</div>
