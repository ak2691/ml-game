package com.example.machiner.service;

import com.example.machiner.repository.UserRepository;
import com.example.machiner.security.AuthenticatedUserDetails;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class MachinerUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    public MachinerUserDetailsService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return userRepository.findByNormalizedEmail(email == null ? null : email.trim().toLowerCase())
                .map(AuthenticatedUserDetails::new)
                .orElseThrow(() -> new UsernameNotFoundException("User not found"));
    }
}
