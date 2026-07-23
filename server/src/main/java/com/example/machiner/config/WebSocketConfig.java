package com.example.machiner.config;

import com.example.machiner.security.SanitizedStompErrorHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final MachinerSecurityProperties securityProperties;

    public WebSocketConfig(MachinerSecurityProperties securityProperties) {
        this.securityProperties = securityProperties;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.setErrorHandler(new SanitizedStompErrorHandler());
        registry.addEndpoint("/ws")
                .setAllowedOrigins(securityProperties.getAllowedOrigins().toArray(String[]::new));
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        int messageLimit = securityProperties.getMaxWebSocketMessageBytes();
        registration
                .setMessageSizeLimit(messageLimit)
                .setSendBufferSizeLimit(securityProperties.getMaxWebSocketSendBufferBytes())
                .setSendTimeLimit(10_000);
    }
}
