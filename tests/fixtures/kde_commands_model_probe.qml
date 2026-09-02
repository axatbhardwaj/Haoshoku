import QtQuick
import QtQml.Models
import org.kde.kdeconnect 1.0

Window {
    visible: true
    CommandsModel {
        id: commands
        deviceId: "phone123"
    }

    property Instantiator commandInstances: Instantiator {
        model: commands
        delegate: QtObject {}
    }

    Component.onCompleted: Qt.callLater(function() {
        Qt.exit(commandInstances.count === 0 ? 42 : 0)
    })
}
