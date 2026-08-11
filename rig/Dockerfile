FROM eclipse-temurin:17-jdk-alpine AS build
WORKDIR /src
COPY . .
RUN mkdir -p /app \
    && javac -d /out src/main/java/uk/gov/hmcts/ccpay/callbackrig/CallbackRig.java \
    && cd /out && jar cfe /app/callback-rig.jar uk.gov.hmcts.ccpay.callbackrig.CallbackRig .

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=build /app/callback-rig.jar /app/callback-rig.jar
EXPOSE 8080
USER 1001:1001
ENTRYPOINT ["java", "-jar", "/app/callback-rig.jar"]