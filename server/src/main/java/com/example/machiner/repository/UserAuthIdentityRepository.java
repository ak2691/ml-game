package com.example.machiner.repository;

import com.example.machiner.domain.UserAuthIdentity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAuthIdentityRepository extends JpaRepository<UserAuthIdentity, UUID> {

    Optional<UserAuthIdentity> findByProviderAndProviderSubject(String provider, String providerSubject);

    List<UserAuthIdentity> findByUserId(UUID userId);
}
