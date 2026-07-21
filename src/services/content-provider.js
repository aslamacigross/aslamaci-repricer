const { draftFromFacts } = require("../domain/content");

class ContentProvider {
  constructor(code, mode) {
    this.code = code;
    this.mode = mode;
  }

  async generate() {
    throw new Error("CONTENT_PROVIDER_NOT_IMPLEMENTED");
  }
}

class DeterministicContentProvider extends ContentProvider {
  constructor() {
    super("DETERMINISTIC", "MOCK_DRAFT");
  }

  async generate(facts) {
    return {
      provider: this.code,
      mode: this.mode,
      content: draftFromFacts(facts),
      externalRequestPerformed: false,
    };
  }
}

module.exports = { ContentProvider, DeterministicContentProvider };
