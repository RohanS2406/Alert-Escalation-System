import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, Users, Settings, X, ChevronDown, ChevronUp } from 'lucide-react';

// ============= BACKEND SIMULATION (In production, this would be separate Node.js/Python backend) =============

class AlertManager {
  constructor() {
    this.alerts = [];
    this.rules = {
      overspeed: { escalate_if_count: 3, window_mins: 60, severity_upgrade: 'Critical' },
      feedback_negative: { escalate_if_count: 2, window_mins: 1440, severity_upgrade: 'Critical' },
      compliance: { auto_close_if: 'document_valid', auto_close_window_mins: 10080 }
    };
    this.eventLog = [];
    this.nextAlertId = 1;
  }

  createAlert(sourceType, severity, metadata = {}) {
    const alert = {
      alertId: `ALT-${this.nextAlertId++}`,
      sourceType,
      severity,
      timestamp: new Date().toISOString(),
      status: 'OPEN',
      metadata: { ...metadata },
      stateHistory: [{ status: 'OPEN', timestamp: new Date().toISOString() }]
    };
    
    this.alerts.push(alert);
    this.logEvent('CREATED', alert.alertId, `Alert created: ${sourceType}`);
    
    // Immediately check escalation rules
    this.evaluateEscalation(alert);
    
    return alert;
  }

  evaluateEscalation(currentAlert) {
    const rule = this.rules[currentAlert.sourceType];
    if (!rule || !rule.escalate_if_count) return;

    const windowStart = new Date(Date.now() - rule.window_mins * 60 * 1000);
    const relatedAlerts = this.alerts.filter(a => 
      a.sourceType === currentAlert.sourceType &&
      a.metadata.driverId === currentAlert.metadata.driverId &&
      new Date(a.timestamp) >= windowStart &&
      (a.status === 'OPEN' || a.status === 'ESCALATED')
    );

    if (relatedAlerts.length >= rule.escalate_if_count && currentAlert.status === 'OPEN') {
      this.escalateAlert(currentAlert.alertId, rule.severity_upgrade);
    }
  }

  escalateAlert(alertId, newSeverity = 'Critical') {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (!alert || alert.status === 'ESCALATED') return;

    alert.status = 'ESCALATED';
    alert.severity = newSeverity;
    alert.stateHistory.push({ 
      status: 'ESCALATED', 
      timestamp: new Date().toISOString(),
      reason: 'Rule threshold exceeded'
    });
    
    this.logEvent('ESCALATED', alertId, `Alert escalated to ${newSeverity}`);
  }

  autoCloseAlert(alertId, reason) {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (!alert || alert.status === 'AUTO-CLOSED' || alert.status === 'RESOLVED') return;

    alert.status = 'AUTO-CLOSED';
    alert.stateHistory.push({ 
      status: 'AUTO-CLOSED', 
      timestamp: new Date().toISOString(),
      reason
    });
    
    this.logEvent('AUTO-CLOSED', alertId, reason);
  }

  resolveAlert(alertId) {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (!alert || alert.status === 'RESOLVED') return;

    alert.status = 'RESOLVED';
    alert.stateHistory.push({ 
      status: 'RESOLVED', 
      timestamp: new Date().toISOString(),
      reason: 'Manually resolved'
    });
    
    this.logEvent('RESOLVED', alertId, 'Manually resolved by operator');
  }

  runAutoCloseJob() {
    const now = Date.now();
    
    this.alerts.forEach(alert => {
      if (alert.status === 'AUTO-CLOSED' || alert.status === 'RESOLVED') return;

      const rule = this.rules[alert.sourceType];
      
      // Check compliance alerts for document renewal
      if (alert.sourceType === 'compliance' && alert.metadata.documentValid) {
        this.autoCloseAlert(alert.alertId, 'Document renewed and validated');
      }
      
      // Auto-close old alerts
      if (rule && rule.auto_close_window_mins) {
        const alertAge = (now - new Date(alert.timestamp).getTime()) / (1000 * 60);
        if (alertAge > rule.auto_close_window_mins) {
          this.autoCloseAlert(alert.alertId, 'Time window expired');
        }
      }
    });
  }

  logEvent(type, alertId, message) {
    this.eventLog.unshift({
      type,
      alertId,
      message,
      timestamp: new Date().toISOString()
    });
    
    if (this.eventLog.length > 50) this.eventLog.pop();
  }

  getStats() {
    const activeAlerts = this.alerts.filter(a => a.status === 'OPEN' || a.status === 'ESCALATED');
    
    return {
      total: this.alerts.length,
      open: this.alerts.filter(a => a.status === 'OPEN').length,
      escalated: this.alerts.filter(a => a.status === 'ESCALATED').length,
      autoClosed: this.alerts.filter(a => a.status === 'AUTO-CLOSED').length,
      resolved: this.alerts.filter(a => a.status === 'RESOLVED').length,
      critical: activeAlerts.filter(a => a.severity === 'Critical').length,
      warning: activeAlerts.filter(a => a.severity === 'Warning').length,
      info: activeAlerts.filter(a => a.severity === 'Info').length
    };
  }

  getTopOffenders(limit = 5) {
    const driverAlerts = {};
    
    this.alerts
      .filter(a => a.status === 'OPEN' || a.status === 'ESCALATED')
      .forEach(alert => {
        const driverId = alert.metadata.driverId || 'Unknown';
        if (!driverAlerts[driverId]) {
          driverAlerts[driverId] = { driverId, count: 0, critical: 0, alerts: [] };
        }
        driverAlerts[driverId].count++;
        if (alert.severity === 'Critical') driverAlerts[driverId].critical++;
        driverAlerts[driverId].alerts.push(alert);
      });

    return Object.values(driverAlerts)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getRecentAutoClosed(hours = 24) {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.alerts
      .filter(a => a.status === 'AUTO-CLOSED' && new Date(a.timestamp) >= cutoff)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
}

// Initialize global alert manager
const alertManager = new AlertManager();

// ============= REACT DASHBOARD COMPONENT =============

export default function AlertDashboard() {
  const [stats, setStats] = useState(alertManager.getStats());
  const [topOffenders, setTopOffenders] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [autoClosedAlerts, setAutoClosedAlerts] = useState([]);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showRules, setShowRules] = useState(false);

  const refreshData = () => {
    setStats(alertManager.getStats());
    setTopOffenders(alertManager.getTopOffenders());
    setRecentEvents(alertManager.eventLog.slice(0, 10));
    setAutoClosedAlerts(alertManager.getRecentAutoClosed(24));
  };

  useEffect(() => {
    refreshData();
    
    // Simulate background job every 30 seconds
    const jobInterval = setInterval(() => {
      alertManager.runAutoCloseJob();
      refreshData();
    }, 30000);

    return () => clearInterval(jobInterval);
  }, []);

  // Demo data generators
  const generateOverspeedAlert = () => {
    const drivers = ['DRV-001', 'DRV-002', 'DRV-003', 'DRV-004'];
    const driver = drivers[Math.floor(Math.random() * drivers.length)];
    alertManager.createAlert('overspeed', 'Warning', {
      driverId: driver,
      speed: Math.floor(Math.random() * 30) + 80,
      location: 'Highway-12'
    });
    refreshData();
  };

  const generateComplianceAlert = () => {
    const drivers = ['DRV-001', 'DRV-002', 'DRV-003'];
    alertManager.createAlert('compliance', 'Warning', {
      driverId: drivers[Math.floor(Math.random() * drivers.length)],
      documentType: 'License',
      expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      documentValid: false
    });
    refreshData();
  };

  const generateFeedbackAlert = () => {
    const drivers = ['DRV-001', 'DRV-002', 'DRV-003'];
    alertManager.createAlert('feedback_negative', 'Info', {
      driverId: drivers[Math.floor(Math.random() * drivers.length)],
      rating: Math.floor(Math.random() * 2) + 1,
      comment: 'Poor driving behavior'
    });
    refreshData();
  };

  const renewDocument = () => {
    const complianceAlerts = alertManager.alerts.filter(
      a => a.sourceType === 'compliance' && (a.status === 'OPEN' || a.status === 'ESCALATED')
    );
    if (complianceAlerts.length > 0) {
      const alert = complianceAlerts[0];
      alert.metadata.documentValid = true;
      alertManager.runAutoCloseJob();
      refreshData();
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'Critical': return 'text-red-600 bg-red-50';
      case 'Warning': return 'text-yellow-600 bg-yellow-50';
      case 'Info': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'OPEN': return 'bg-blue-100 text-blue-800';
      case 'ESCALATED': return 'bg-red-100 text-red-800';
      case 'AUTO-CLOSED': return 'bg-green-100 text-green-800';
      case 'RESOLVED': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Alert Escalation & Resolution System</h1>
          <p className="text-gray-600">Intelligent monitoring and automated alert management</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Critical</p>
                <p className="text-2xl font-bold text-red-600">{stats.critical}</p>
              </div>
              <AlertTriangle className="text-red-600" size={32} />
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Warning</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.warning}</p>
              </div>
              <AlertTriangle className="text-yellow-600" size={32} />
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Escalated</p>
                <p className="text-2xl font-bold text-orange-600">{stats.escalated}</p>
              </div>
              <TrendingUp className="text-orange-600" size={32} />
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Auto-Closed</p>
                <p className="text-2xl font-bold text-green-600">{stats.autoClosed}</p>
              </div>
              <CheckCircle className="text-green-600" size={32} />
            </div>
          </div>
        </div>

        {/* Demo Controls */}
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Settings size={20} />
            Demo Controls
          </h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={generateOverspeedAlert} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
              Generate Overspeed Alert
            </button>
            <button onClick={generateComplianceAlert} className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600">
              Generate Compliance Alert
            </button>
            <button onClick={generateFeedbackAlert} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Generate Feedback Alert
            </button>
            <button onClick={renewDocument} className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
              Renew Document (Auto-Close)
            </button>
            <button onClick={() => setShowRules(!showRules)} className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600">
              {showRules ? 'Hide' : 'Show'} Rules
            </button>
          </div>
          
          {showRules && (
            <div className="mt-4 p-4 bg-gray-50 rounded">
              <h4 className="font-semibold mb-2">Active Escalation Rules:</h4>
              <pre className="text-xs bg-white p-3 rounded overflow-auto">
                {JSON.stringify(alertManager.rules, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Top Offenders */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Users size={20} />
              Top 5 Offenders
            </h3>
            <div className="space-y-3">
              {topOffenders.length === 0 ? (
                <p className="text-gray-500 text-sm">No active alerts</p>
              ) : (
                topOffenders.map((offender, idx) => (
                  <div key={idx} className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium">{offender.driverId}</span>
                      <span className="text-sm font-semibold text-red-600">{offender.count} alerts</span>
                    </div>
                    <div className="text-xs text-gray-600">
                      {offender.critical > 0 && <span className="text-red-600">{offender.critical} Critical</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Middle Column - Recent Events */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Clock size={20} />
              Recent Events
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {recentEvents.map((event, idx) => (
                <div key={idx} className="p-2 bg-gray-50 rounded text-sm">
                  <div className="flex justify-between items-start">
                    <span className={`font-medium ${
                      event.type === 'ESCALATED' ? 'text-red-600' :
                      event.type === 'AUTO-CLOSED' ? 'text-green-600' :
                      event.type === 'RESOLVED' ? 'text-gray-600' :
                      'text-blue-600'
                    }`}>
                      {event.type}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {event.alertId}: {event.message}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column - Auto-Closed Alerts */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <CheckCircle size={20} />
              Recently Auto-Closed
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {autoClosedAlerts.length === 0 ? (
                <p className="text-gray-500 text-sm">No auto-closed alerts</p>
              ) : (
                autoClosedAlerts.map((alert, idx) => (
                  <div key={idx} className="p-2 bg-green-50 rounded text-sm cursor-pointer hover:bg-green-100" onClick={() => setSelectedAlert(alert)}>
                    <div className="flex justify-between">
                      <span className="font-medium">{alert.alertId}</span>
                      <span className="text-xs text-gray-600">{alert.sourceType}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {alert.stateHistory[alert.stateHistory.length - 1]?.reason}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Alert Detail Modal */}
        {selectedAlert && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setSelectedAlert(null)}>
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedAlert.alertId}</h2>
                    <p className="text-gray-600">{selectedAlert.sourceType}</p>
                  </div>
                  <button onClick={() => setSelectedAlert(null)} className="text-gray-500 hover:text-gray-700">
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-2">
                    <span className={`px-3 py-1 rounded text-sm font-medium ${getSeverityColor(selectedAlert.severity)}`}>
                      {selectedAlert.severity}
                    </span>
                    <span className={`px-3 py-1 rounded text-sm font-medium ${getStatusColor(selectedAlert.status)}`}>
                      {selectedAlert.status}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Metadata</h3>
                    <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto">
                      {JSON.stringify(selectedAlert.metadata, null, 2)}
                    </pre>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">State History</h3>
                    <div className="space-y-2">
                      {selectedAlert.stateHistory.map((state, idx) => (
                        <div key={idx} className="flex items-start gap-3 pb-3 border-b last:border-0">
                          <div className={`w-3 h-3 rounded-full mt-1 ${getStatusColor(state.status)}`} />
                          <div className="flex-1">
                            <div className="flex justify-between">
                              <span className="font-medium">{state.status}</span>
                              <span className="text-xs text-gray-500">
                                {new Date(state.timestamp).toLocaleString()}
                              </span>
                            </div>
                            {state.reason && <p className="text-sm text-gray-600 mt-1">{state.reason}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(selectedAlert.status === 'OPEN' || selectedAlert.status === 'ESCALATED') && (
                    <button 
                      onClick={() => {
                        alertManager.resolveAlert(selectedAlert.alertId);
                        refreshData();
                        setSelectedAlert(null);
                      }}
                      className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      Manually Resolve
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
