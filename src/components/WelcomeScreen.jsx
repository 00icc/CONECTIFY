import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { BridgeError } from '../utils.js';
import { showNotification } from '../theme.js';
import '../styles/WelcomeScreen.css';
import '../styles/cinematic.css';

const WelcomeScreen = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [installationStatus, setInstallationStatus] = useState({
    afterEffects: false,
    resolve: false,
    error: null
  });
  const [isInstalling, setIsInstalling] = useState(false);

  const handleInstallation = async (app) => {
    setIsInstalling(true);
    setInstallationStatus(prev => ({ ...prev, error: null }));
    
    try {
      await invoke('configure_app', { app });
      setInstallationStatus(prev => ({ 
        ...prev, 
        [app === 'ae' ? 'afterEffects' : 'resolve']: true 
      }));
      showNotification(`${app === 'ae' ? 'After Effects' : 'DaVinci Resolve'} configured successfully`);
    } catch (error) {
      const bridgeError = error instanceof BridgeError ? error : 
        new BridgeError('Installation', error.message);
      setInstallationStatus(prev => ({ ...prev, error: bridgeError.message }));
      showNotification(bridgeError.message, 5000, 'error');
    } finally {
      setIsInstalling(false);
    }
  };

  const steps = [
    {
      title: 'Welcome to CONECTIFY',
      content: 'Your bridge between After Effects and DaVinci Resolve. Let\'s get you started with a quick setup.',
      image: '/assets/welcome.svg'
    },
    {
      title: 'After Effects Setup',
      content: 'We\'ll install the necessary scripts and configure After Effects for seamless integration.',
      image: '/assets/ae-integration.svg',
        action: {
        label: 'Install After Effects Integration',
        onClick: () => handleInstallation('ae')
        }
      },
      {
        title: 'DaVinci Resolve Setup',
        content: 'Now, let\'s set up the DaVinci Resolve bridge for smooth workflow integration.',
        image: '/assets/resolve-integration.svg',
        action: {
        label: 'Install Resolve Integration',
        onClick: () => handleInstallation('resolve')
        }

    },
    {
      title: 'Ready to Create',
      content: 'Everything is set up! Click \'Start Creating\' to begin your seamless workflow with CONECTIFY.',
      image: '/assets/ready.svg'
    }
  ];

  const handleNext = async () => {
    try {
      const currentStepData = steps[currentStep];
      if (currentStepData.action && !installationStatus[currentStep === 1 ? 'afterEffects' : 'resolve']) {
        return;
      }
      
      if (currentStep < steps.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        await invoke('save_config', { completed_setup: true });
        onComplete();
      }
    } catch (error) {
      showNotification(error.message, 5000, 'error');
    }
  };

  const currentStepData = steps[currentStep];

  return (
    <div className="welcome-screen cinematic-bg">
      <div className="cinematic-grain" />
      <div className="welcome-card glass-panel">
        <div className="step-indicator">
          {steps.map((_, index) => (
            <div
              key={index}
              className={`step-dot ${index === currentStep ? 'active' : ''}`}
            />
          ))}
        </div>
        
        <div className="welcome-content">
          <img
            src={currentStepData.image}
            alt={currentStepData.title}
            className="welcome-image"
          />
          <h1>{currentStepData.title}</h1>
          <p>{currentStepData.content}</p>
          
          {currentStepData.action && (
            <button
              className="cinematic-button installation-button"
              onClick={currentStepData.action.onClick}
              disabled={installationStatus[currentStep === 1 ? 'afterEffects' : 'resolve']}
            >
              {installationStatus[currentStep === 1 ? 'afterEffects' : 'resolve']
                ? '✓ Installation Complete'
                : currentStepData.action.label}
            </button>
          )}
        </div>

        {installationStatus.error && (
          <div className="status error">{installationStatus.error}</div>
        )}
        <div className="welcome-actions">
          <button
          className="cinematic-button"
          onClick={handleNext}
          disabled={
            isInstalling || 
            (currentStepData.action && !installationStatus[currentStep === 1 ? 'afterEffects' : 'resolve'])
          }
          >
          {currentStep === steps.length - 1 ? 'Start Creating' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;