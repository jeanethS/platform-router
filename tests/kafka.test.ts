import { KafkaConnector } from "../src/kafka";

// Mock kafkajs
jest.mock("kafkajs", () => {
  const mockConsumer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
  };
  const mockProducer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
  };
  const mockKafka = {
    consumer: jest.fn().mockReturnValue(mockConsumer),
    producer: jest.fn().mockReturnValue(mockProducer),
  };

  return {
    Kafka: jest.fn().mockImplementation(() => mockKafka),
    __mockConsumer: mockConsumer,
    __mockProducer: mockProducer,
  };
});

describe("KafkaConnector", () => {
  it("creates Kafka with correct brokers and clientId", async () => {
    const { Kafka } = require("kafkajs");
    const connector = new KafkaConnector(["broker1:9092", "broker2:9092"], "test-client");
    expect(Kafka).toHaveBeenCalledWith({
      brokers: ["broker1:9092", "broker2:9092"],
      clientId: "test-client",
    });
  });

  it("connects consumer and producer on start()", async () => {
    const { __mockConsumer, __mockProducer } = require("kafkajs");
    const connector = new KafkaConnector(["localhost:9092"], "test");
    await connector.start();
    expect(__mockConsumer.connect).toHaveBeenCalled();
    expect(__mockProducer.connect).toHaveBeenCalled();
    expect(__mockConsumer.subscribe).toHaveBeenCalledWith({
      topic: "analysis.cluster_reports",
      fromBeginning: false,
    });
    expect(connector.ready).toBe(true);
  });

  it("runs consumer with eachMessage handler", async () => {
    const { __mockConsumer } = require("kafkajs");
    const connector = new KafkaConnector(["localhost:9092"], "test");
    await connector.start();
    await connector.run();
    expect(__mockConsumer.run).toHaveBeenCalledWith(
      expect.objectContaining({ eachMessage: expect.any(Function) }),
    );
  });

  it("disconnects consumer and producer on shutdown()", async () => {
    const { __mockConsumer, __mockProducer } = require("kafkajs");
    const connector = new KafkaConnector(["localhost:9092"], "test");
    await connector.start();
    await connector.shutdown();
    expect(__mockConsumer.disconnect).toHaveBeenCalled();
    expect(__mockProducer.disconnect).toHaveBeenCalled();
    expect(connector.ready).toBe(false);
  });
});
